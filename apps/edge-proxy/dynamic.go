package main

import (
	"log"
	"time"
)

// Dynamic mode polls the daemon for the current set of proxied servers and
// (re)configures listeners on the fly — so creating a sleeping server in the
// panel automatically makes it wake-on-join, with no proxy restart.
type Dynamic struct {
	p      *Proxy
	active map[string]func() // listen address -> stop func
}

func (d *Dynamic) run() {
	d.active = map[string]func(){}
	log.Println("[edge] dynamic mode — polling daemon for routes every 15s")
	for {
		routes, err := d.p.daemon.Routes()
		if err != nil {
			log.Printf("[edge] route fetch failed: %v", err)
		} else {
			d.reconcile(routes)
		}
		time.Sleep(15 * time.Second)
	}
}

func (d *Dynamic) reconcile(routes []Route) {
	want := map[string]Route{}
	for _, r := range routes {
		want[r.Listen] = r
	}
	// stop routes that disappeared
	for listen, stop := range d.active {
		if _, ok := want[listen]; !ok {
			log.Printf("[edge] removing route %s", listen)
			stop()
			delete(d.active, listen)
		}
	}
	// start newly-added routes
	for listen, r := range want {
		if _, ok := d.active[listen]; ok {
			continue
		}
		stop, err := d.p.startRoute(r)
		if err != nil {
			log.Printf("[edge] start %s failed: %v", listen, err)
			continue
		}
		d.active[listen] = stop
	}
}
