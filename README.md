# ⟁ Aether

**Premium multi-game server hosting — Minecraft, Icarus & more.**
Instant deploys, a stunning glass/bento control panel, wake-on-join sleeping, one-click mods, and a clean API built for your **custom launcher**.

Aether is a self-hostable platform built to out-class Pterodactyl, Aternos, Shockbyte & GPORTAL on three axes at once: **UX**, **breadth** (any game via data-only templates), and **trust** (live telemetry, isolation, transparent sleeping).

---

## ✨ Highlights

- **Multi-game by design** — a generic *template (egg)* engine. Minecraft (Java + Bedrock: Paper, Purpur, Fabric, Forge, NeoForge, Vanilla, modpacks) and **Icarus** ship today; Valheim, Palworld & Rust are included as bonus templates. Adding a game is *data, not code*.
- **Beautiful control panel** — "Sci-Fi Lab" dark theme, glassmorphism + bento dashboard, live console (with command input), real-time CPU/RAM/disk/players, file manager, backups, settings, network.
- **Wake-on-join sleeping** — servers sleep when empty and a no-login **shareable wake link** can start them.
- **Free subdomains** — claim `you.<base>` and the panel writes A + SRV records (Cloudflare) so players connect by name, no port needed.
- **Custom launcher API** — device-code OAuth + a versioned REST/WebSocket API returning live `ConnectionInfo` so your launcher can authenticate users and auto-join.
- **Secure & isolated** — per-container CPU/RAM/PID limits, RCON bound to loopback only, TOTP 2FA, scoped & hashed API keys, audit logs, path-jailed file manager.
- **One-command self-host** on Ubuntu with Docker.

---

## 🏗️ Architecture

```
┌─────────────┐     HTTPS / WS      ┌──────────────────┐
│   Browser   │ ──────────────────▶ │   Panel (Next.js)│  control plane
│  + Launcher │ ◀── live console ── │   PostgreSQL     │  users, servers, nodes…
└─────────────┘        │            └────────┬─────────┘
                       │  Bearer (node token) │  ServerBuildSpec
                       │                      ▼
                       │             ┌──────────────────┐
                       └───── WS ───▶│  Daemon (Node)   │  data plane
                          (JWT)      │  dockerode → 🐳   │  containers, RCON,
                                     └──────────────────┘  files, backups, stats
```

- **`packages/shared`** — dependency-free domain types, permission scopes, and the **game template engine** (Minecraft / Icarus / …). Imported by both apps.
- **`apps/panel`** — Next.js (App Router) marketing site + dashboard + REST API + launcher API; Prisma + PostgreSQL.
- **`apps/daemon`** — Node service that controls Docker via `dockerode`: container lifecycle, console/stats WebSocket streaming, RCON, a path-jailed file manager and tar.gz backups.

The browser connects **directly** to the daemon's WebSocket using a short-lived JWT the panel mints (HMAC-signed with the node's shared secret), exactly like Pterodactyl ↔ Wings.

---

## 🚀 Quick start (Ubuntu, Docker)

```bash
git clone <your-repo> aether && cd aether
sudo bash deploy/install.sh
```

The installer provisions Docker, generates secrets in `.env`, builds the images, and brings up **panel + daemon + Postgres + Caddy**. Open the printed URL and register — the **first account becomes the admin**.

> Set `APP_DOMAIN=panel.example.com` before running for automatic HTTPS.

### Manual / dev

```bash
npm install
npm run build:shared
cp .env.example .env                 # edit secrets
cp apps/panel/.env.example apps/panel/.env
# start Postgres (e.g. docker run … postgres:16), then:
npm run db:migrate --workspace @aether/panel    # or db:push for dev
npm run db:seed   --workspace @aether/panel
npm run dev                          # panel :3000 + daemon :8080
```

The daemon needs a reachable Docker engine (`/var/run/docker.sock`).

---

## 🎮 Adding a game

Write one `GameTemplate` object in `packages/shared/src/templates/` and register it in `templates/index.ts`. It declares the Docker image(s), startup/stop behaviour, ports, env variables (surfaced as a settings form automatically), install script and capability flags (`rcon`, `wine`, `steamcmd`, `mods`, …). No daemon or panel changes required.

See `icarus.ts` for a SteamCMD-under-Wine example and `minecraft.ts` for an RCON example.

---

## 🔌 Connect your launcher

Aether exposes `/api/v1` with a desktop-friendly device-code flow:

1. `POST /api/v1/auth/device/start` → show `user_code` + `verification_uri`.
2. User approves at `/link`; you poll `POST /api/v1/auth/device/poll` → tokens.
3. `GET /api/v1/client` lists servers; `…/connection` returns `ip:port` + status for auto-join.

Full guide: **`/docs/launcher`** (in-app) — or `docs/LAUNCHER.md`.

---

## 📂 Repo layout

```
packages/shared      types, scopes, game templates (+ vitest)
apps/panel           Next.js panel (UI + REST + launcher API + cron scheduler + monitor)
apps/daemon          Docker control daemon + SFTP server (+ vitest)
apps/edge-proxy      Go wake-on-join proxy (sleeping servers)
apps/discord-bot     Discord slash-command control bot
examples/launcher    zero-dep reference client for the launcher API
deploy/              install.sh, Caddyfile, systemd unit
docker-compose.yml   one-host stack
.github/workflows    CI (build, typecheck, tests, go build)
```

The dashboard ships a live console, file manager + **SFTP**, **content browser**
(Modrinth **and CurseForge** mod/plugin/modpack install), **scheduled tasks**
(cron restarts/commands/backups via an in-process scheduler), backups, network +
free subdomains + wake links, **sub-users** (scoped team access), a **credit
wallet** (per-GB-hour metering, demo top-ups, admin grants), per-server
**auto-stop / auto-restart** behaviour, and account/2FA.

End-to-end **wake-on-join**: when a server has auto-stop on, the daemon binds its
game port on loopback and the `edge-proxy` (in `docker-compose`, dynamic mode)
fronts the public port — discovering proxied servers from the daemon automatically.

**Operations**: a per-minute monitor checks node reachability and detects crashed
servers (with optional auto-restart), raising deduped alerts surfaced in the admin
panel and pushed to a **Discord webhook**. **SFTP** runs in the daemon (jailed per
server, validated against the panel). Unit tests (vitest) cover the template engine
and the path jail; CI runs build + typecheck + tests + `go build`.

## 🛡️ DDoS protection (layered)

Aether ships defence-in-depth — no single layer is relied upon:

| Layer | Where | What it does |
|-------|-------|--------------|
| **L7 — panel/API** | `apps/panel/src/middleware.ts` | Per-IP rate limiting (strict on auth), `429` + `Retry-After`, security headers |
| **Minecraft-aware** | `apps/edge-proxy` guard | Per-IP connection caps + rate, ping-flood throttle, slow-loris handshake timeout, junk-flood auto temp-ban, IP blocklist, PROXY-protocol real-IP |
| **L4 — host** | `deploy/firewall.sh` (nftables) | Drop conntrack-INVALID, per-source SYN-flood limiting, UDP anti-amplification, ICMP/SSH rate limits, **Attack Mode** |
| **Edge / TLS** | Caddy | Auto-HTTPS, HSTS, security headers, HTTP/2-3 |
| **Upstream (optional)** | provider | Front game traffic with a scrubbing proxy (Cloudflare Spectrum / TCPShield); the proxy reads PROXY protocol to preserve real client IPs |

Apply the host firewall: `sudo SSH_PORT=22 bash deploy/firewall.sh apply`
(or `attack` for tightened limits while under attack). The installer also wires
it in when run with `APPLY_FIREWALL=1`. Tune the proxy guard via the `DDOS_*`
env vars (see `apps/edge-proxy/README.md`).

## 🔐 Security notes

- Change every secret in `.env`. RCON ports are bound to `127.0.0.1` only.
- For production, front the daemon WebSocket with TLS (Caddy on a `node.<domain>` subdomain) and set the node's scheme to `https`.
- Consider Docker `userns-remap` and per-template `seccomp`/AppArmor profiles for stronger isolation (see `docs/`).

## License

MIT.
