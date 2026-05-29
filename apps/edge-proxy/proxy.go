package main

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"sync"
	"time"
)

// Route maps a public listen address to a backend game container, with the
// daemon serverId used to wake it on join and stop it when idle.
type Route struct {
	Listen      string `json:"listen"`      // ":25565"
	Backend     string `json:"backend"`     // "127.0.0.1:25600" (the daemon-bound internal port)
	ServerID    string `json:"serverId"`    // Aether server id
	IdleSeconds int    `json:"idleSeconds"` // stop after this long empty (0 = never)
}

func chatJSON(text, color string) string {
	return fmt.Sprintf(`{"text":%q,"color":%q}`, text, color)
}

func (p *Proxy) statusJSON(protocol int, state string) string {
	motd := "§b▶ Click to start §7— waking up…"
	if state == "starting" || state == "installing" {
		motd = "§e⏳ Server is starting — rejoin in a few seconds"
	}
	// Use the client's protocol so no version-mismatch warning is shown.
	return fmt.Sprintf(
		`{"version":{"name":"Aether","protocol":%d},"players":{"max":0,"online":0},"description":{"text":%q}}`,
		protocol, motd,
	)
}

type Proxy struct {
	daemon *DaemonClient
	guard  *Guard
}

// clientIP returns the real client IP, honouring PROXY protocol v1 when enabled
// (so DDoS limits apply to the true source behind an upstream scrubber).
func (p *Proxy) clientIP(conn net.Conn, br *bufio.Reader) string {
	if p.guard != nil && p.guard.proxyProtocol {
		if head, err := br.Peek(5); err == nil && string(head) == "PROXY" {
			line, err := br.ReadString('\n')
			if err == nil {
				parts := strings.Fields(strings.TrimSpace(line))
				if len(parts) >= 3 {
					return parts[2] // PROXY TCP4 <src> <dst> <sport> <dport>
				}
			}
		}
	}
	if host, _, err := net.SplitHostPort(conn.RemoteAddr().String()); err == nil {
		return host
	}
	return conn.RemoteAddr().String()
}

func (p *Proxy) handshakeTimeout() time.Duration {
	if p.guard != nil && p.guard.handshakeWait > 0 {
		return p.guard.handshakeWait
	}
	return 10 * time.Second
}

// handleConn inspects the handshake and either proxies (server up), serves a
// status/MOTD (ping while down) or triggers a wake (login while down).
func (p *Proxy) handleConn(route Route, conn net.Conn) {
	defer conn.Close()
	br := bufio.NewReader(conn)
	ip := p.clientIP(conn, br)

	if p.guard != nil {
		if ok, reason := p.guard.Allow(ip); !ok {
			log.Printf("[guard] drop %s → %s: %s", ip, route.Listen, reason)
			return
		}
		defer p.guard.Release(ip)
	}

	// Tight deadline for the handshake defeats slow-loris / idle hold attacks.
	conn.SetDeadline(time.Now().Add(p.handshakeTimeout()))

	hs, err := readHandshake(br)
	if err != nil {
		if p.guard != nil {
			p.guard.Strike(ip) // malformed / aborted handshake = abuse signal
		}
		return
	}

	state, _, _ := p.daemon.Status(route.ServerID)
	running := state == "running"

	if running {
		p.pipe(route, conn, br, hs)
		return
	}

	switch hs.nextState {
	case 1: // status ping
		if p.guard != nil && !p.guard.AllowPing(ip) {
			return // ping flood
		}
		p.serveStatus(conn, br, hs, state)
	case 2: // login → wake the server
		log.Printf("[wake] login to %s while %s — starting", route.ServerID, state)
		if state == "offline" || state == "errored" {
			if err := p.daemon.Power(route.ServerID, "start"); err != nil {
				log.Printf("[wake] start failed: %v", err)
			}
		}
		// best-effort: consume login start, then kick with a friendly message
		_, _ = readVarInt(br) // len
		_, _ = readVarInt(br) // id
		payload := appendString(nil, chatJSON("Server is starting — rejoin in a few seconds!", "aqua"))
		_ = writePacket(conn, 0x00, payload) // login disconnect
	}
}

func (p *Proxy) serveStatus(conn net.Conn, br *bufio.Reader, hs *handshake, state string) {
	// read status request (0x00, empty)
	if _, err := readVarInt(br); err != nil {
		return
	}
	if _, err := readVarInt(br); err != nil {
		return
	}
	payload := appendString(nil, p.statusJSON(hs.protocol, state))
	if err := writePacket(conn, 0x00, payload); err != nil {
		return
	}
	// echo ping if the client sends one (0x01 + int64)
	if _, err := readVarInt(br); err == nil {
		id, err := readVarInt(br)
		if err == nil && id == 0x01 {
			var t [8]byte
			if _, err := io.ReadFull(br, t[:]); err == nil {
				_ = writePacket(conn, 0x01, t[:])
			}
		}
	}
}

// pipe replays the handshake to the backend and copies bytes both ways.
func (p *Proxy) pipe(route Route, client net.Conn, br *bufio.Reader, hs *handshake) {
	backend, err := net.DialTimeout("tcp", route.Backend, 5*time.Second)
	if err != nil {
		log.Printf("[proxy] backend dial failed %s: %v", route.Backend, err)
		return
	}
	defer backend.Close()
	client.SetDeadline(time.Time{}) // clear the handshake deadline for the session

	// Re-send the original handshake bytes we already consumed.
	payload := []byte{}
	payload = appendVarInt(payload, hs.protocol)
	// note: we didn't retain address/port; reconstruct a minimal handshake
	payload = appendString(payload, "aether")
	payload = append(payload, 0x00, 0x00) // port 0 (backend ignores)
	payload = appendVarInt(payload, hs.nextState)
	if err := writePacket(backend, 0x00, payload); err != nil {
		return
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); io.Copy(backend, br); backend.(*net.TCPConn).CloseWrite() }()
	go func() { defer wg.Done(); io.Copy(client, backend); client.(*net.TCPConn).CloseWrite() }()
	wg.Wait()
}

// watchIdle stops the server after it has been empty for IdleSeconds.
func (p *Proxy) watchIdle(route Route, stop <-chan struct{}) {
	if route.IdleSeconds <= 0 {
		return
	}
	var emptySince time.Time
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			state, online, err := p.daemon.Status(route.ServerID)
			if err != nil || state != "running" {
				emptySince = time.Time{}
				continue
			}
			if online == 0 {
				if emptySince.IsZero() {
					emptySince = time.Now()
				} else if time.Since(emptySince) >= time.Duration(route.IdleSeconds)*time.Second {
					log.Printf("[idle] %s empty for %ds — stopping", route.ServerID, route.IdleSeconds)
					_ = p.daemon.Power(route.ServerID, "stop")
					emptySince = time.Time{}
				}
			} else {
				emptySince = time.Time{}
			}
		}
	}
}

// startRoute begins listening for a route and returns a stop function.
func (p *Proxy) startRoute(route Route) (func(), error) {
	ln, err := net.Listen("tcp", route.Listen)
	if err != nil {
		return nil, err
	}
	log.Printf("[edge] %s → %s (server %s, idle %ds)", route.Listen, route.Backend, route.ServerID, route.IdleSeconds)
	stop := make(chan struct{})
	go p.watchIdle(route, stop)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go p.handleConn(route, conn)
		}
	}()
	return func() {
		close(stop)
		ln.Close()
	}, nil
}

// listen starts a route and blocks forever (used by the static single-route path).
func (p *Proxy) listen(route Route) {
	if _, err := p.startRoute(route); err != nil {
		log.Fatalf("listen %s: %v", route.Listen, err)
	}
	select {}
}
