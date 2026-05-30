package main

import (
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Guard implements Minecraft-aware L4/L7 DDoS mitigation at the edge proxy:
// per-IP connection caps + rate, ping-flood throttling, and automatic temporary
// bans for IPs that repeatedly send garbage / abort handshakes (slow-loris,
// junk floods). A static blocklist is always denied.
type Guard struct {
	mu sync.Mutex

	maxConnsPerIP int
	connPerMin    int
	pingPerMin    int
	banStrikes    int
	banDuration   time.Duration
	handshakeWait time.Duration
	proxyProtocol bool
	maxIPs        int // hard cap on tracked IPs (bounds memory under a unique-IP flood)

	blocklist map[string]bool
	ips       map[string]*ipState
}

type ipState struct {
	conns       int
	windowStart time.Time
	connCount   int
	pingCount   int
	strikes     int
	banUntil    time.Time
	lastSeen    time.Time
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func LoadGuard() *Guard {
	g := &Guard{
		maxConnsPerIP: envInt("DDOS_MAX_CONN_PER_IP", 8),
		connPerMin:    envInt("DDOS_CONN_PER_MIN", 40),
		pingPerMin:    envInt("DDOS_PING_PER_MIN", 60),
		banStrikes:    envInt("DDOS_BAN_STRIKES", 10),
		banDuration:   time.Duration(envInt("DDOS_BAN_SECONDS", 600)) * time.Second,
		handshakeWait: time.Duration(envInt("DDOS_HANDSHAKE_MS", 4000)) * time.Millisecond,
		proxyProtocol: os.Getenv("PROXY_PROTOCOL") == "1",
		maxIPs:        envInt("DDOS_MAX_TRACKED_IPS", 100000),
		blocklist:     map[string]bool{},
		ips:           map[string]*ipState{},
	}
	for _, ip := range strings.Split(os.Getenv("DDOS_BLOCKLIST"), ",") {
		if ip = strings.TrimSpace(ip); ip != "" {
			g.blocklist[ip] = true
		}
	}
	go g.cleanup()
	log.Printf("[guard] anti-DDoS active — %d conns/ip, %d conns/min/ip, ban after %d strikes for %s",
		g.maxConnsPerIP, g.connPerMin, g.banStrikes, g.banDuration)
	return g
}

func (g *Guard) state(ip string) *ipState {
	s := g.ips[ip]
	if s == nil {
		if len(g.ips) >= g.maxIPs {
			// Map is full (likely a unique-IP flood). Evict idle, non-banned
			// entries; if still full, return an unstored state so memory stays bounded.
			now := time.Now()
			for k, v := range g.ips {
				if v.conns == 0 && now.After(v.banUntil) {
					delete(g.ips, k)
					if len(g.ips) < g.maxIPs {
						break
					}
				}
			}
			if len(g.ips) >= g.maxIPs {
				return &ipState{windowStart: time.Now()}
			}
		}
		s = &ipState{windowStart: time.Now()}
		g.ips[ip] = s
	}
	return s
}

// Allow decides whether to accept a new connection from ip. Returns a reason on denial.
func (g *Guard) Allow(ip string) (bool, string) {
	if g.blocklist[ip] {
		return false, "blocklisted"
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	s := g.state(ip)
	s.lastSeen = now

	if now.Before(s.banUntil) {
		return false, "temporarily banned"
	}
	// rolling 1-minute connection-rate window
	if now.Sub(s.windowStart) > time.Minute {
		s.windowStart = now
		s.connCount = 0
		s.pingCount = 0
	}
	if s.conns >= g.maxConnsPerIP {
		return false, "too many concurrent connections"
	}
	if s.connCount >= g.connPerMin {
		g.strikeLocked(s, now) // hammering the connect rate counts as abuse
		return false, "connection rate exceeded"
	}
	s.conns++
	s.connCount++
	return true, ""
}

// AllowPing throttles status pings (SLP) per IP within the rate window.
func (g *Guard) AllowPing(ip string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	s := g.state(ip)
	s.pingCount++
	return s.pingCount <= g.pingPerMin
}

func (g *Guard) Release(ip string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if s := g.ips[ip]; s != nil && s.conns > 0 {
		s.conns--
	}
}

// Strike records abusive behaviour (bad handshake, timeout); bans past threshold.
func (g *Guard) Strike(ip string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.strikeLocked(g.state(ip), time.Now())
}

func (g *Guard) strikeLocked(s *ipState, now time.Time) {
	s.strikes++
	if s.strikes >= g.banStrikes {
		s.banUntil = now.Add(g.banDuration)
		s.strikes = 0
	}
}

func (g *Guard) cleanup() {
	t := time.NewTicker(2 * time.Minute)
	defer t.Stop()
	for range t.C {
		g.mu.Lock()
		now := time.Now()
		for ip, s := range g.ips {
			if s.conns == 0 && now.Sub(s.lastSeen) > 10*time.Minute && now.After(s.banUntil) {
				delete(g.ips, ip)
			}
		}
		g.mu.Unlock()
	}
}
