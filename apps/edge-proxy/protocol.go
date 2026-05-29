package main

import (
	"bufio"
	"encoding/binary"
	"errors"
	"io"
)

// Minimal Minecraft (Java) protocol helpers for the Server List Ping (SLP)
// handshake and login phase — just enough to detect intent and reply with a
// status/MOTD or a friendly "starting" disconnect.

func readVarInt(r io.Reader) (int, error) {
	var value int
	var pos uint
	var b [1]byte
	for {
		if _, err := io.ReadFull(r, b[:]); err != nil {
			return 0, err
		}
		value |= int(b[0]&0x7F) << pos
		if b[0]&0x80 == 0 {
			break
		}
		pos += 7
		if pos >= 35 {
			return 0, errors.New("VarInt too big")
		}
	}
	return value, nil
}

func writeVarInt(w io.Writer, value int) error {
	uv := uint32(value)
	var buf [5]byte
	i := 0
	for {
		b := byte(uv & 0x7F)
		uv >>= 7
		if uv != 0 {
			b |= 0x80
		}
		buf[i] = b
		i++
		if uv == 0 {
			break
		}
	}
	_, err := w.Write(buf[:i])
	return err
}

func readString(r io.Reader) (string, error) {
	n, err := readVarInt(r)
	if err != nil {
		return "", err
	}
	if n < 0 || n > 1<<16 {
		return "", errors.New("string too long")
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return "", err
	}
	return string(buf), nil
}

// handshake holds the fields we care about from packet 0x00.
type handshake struct {
	protocol  int
	nextState int // 1 = status, 2 = login
}

// readHandshake reads the framed handshake packet from a buffered reader.
func readHandshake(br *bufio.Reader) (*handshake, error) {
	// packet length (we don't strictly need it but must consume the framing)
	if _, err := readVarInt(br); err != nil {
		return nil, err
	}
	id, err := readVarInt(br)
	if err != nil {
		return nil, err
	}
	if id != 0x00 {
		return nil, errors.New("expected handshake packet 0x00")
	}
	proto, err := readVarInt(br) // protocol version
	if err != nil {
		return nil, err
	}
	if _, err := readString(br); err != nil { // server address
		return nil, err
	}
	var port uint16
	if err := binary.Read(br, binary.BigEndian, &port); err != nil { // server port
		return nil, err
	}
	next, err := readVarInt(br)
	if err != nil {
		return nil, err
	}
	return &handshake{protocol: proto, nextState: next}, nil
}

// writePacket frames a packet: VarInt(len) + VarInt(id) + payload.
func writePacket(w io.Writer, id int, payload []byte) error {
	body := make([]byte, 0, len(payload)+2)
	var idbuf [5]byte
	tmp := idbuf[:0]
	tmp = appendVarInt(tmp, id)
	body = append(body, tmp...)
	body = append(body, payload...)
	if err := writeVarInt(w, len(body)); err != nil {
		return err
	}
	_, err := w.Write(body)
	return err
}

func appendVarInt(b []byte, value int) []byte {
	uv := uint32(value)
	for {
		x := byte(uv & 0x7F)
		uv >>= 7
		if uv != 0 {
			x |= 0x80
		}
		b = append(b, x)
		if uv == 0 {
			return b
		}
	}
}

func appendString(b []byte, s string) []byte {
	b = appendVarInt(b, len(s))
	return append(b, s...)
}
