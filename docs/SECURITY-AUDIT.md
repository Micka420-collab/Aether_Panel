# Security audit — hardening status

An adversarial, multi-dimension security audit was run against the panel and
backend (authentication, authorization/IDOR, secrets & git hygiene,
injection/SSRF/path traversal, DoS/validation, dependencies/deployment), with
each high/critical finding independently verified.

**Secrets exposure for the public repo: CLEAR** — no `.env`, key, or credential
is tracked; tracked files contain only documented dev placeholders.

## Fixed (confirmed must-fix)

- **Secrets fail-closed.** Production now refuses to boot if `AUTH_SECRET`,
  `API_JWT_SECRET` or `DAEMON_TOKEN` is unset, a known placeholder, or `<16`
  chars (panel `lib/env.ts`, daemon `config.ts`). The previous fallback path
  silently shipped dev defaults. (Enforced at runtime, not during `next build`.)
- **TOTP-secret encryption key** is now derived with **HKDF-SHA256** + a
  domain-separation label and the ciphertext is **versioned** (`lib/crypto.ts`),
  instead of a bare SHA-256 of `AUTH_SECRET`.
- **Sub-user scope bypass closed.** `/api/v1/client/servers/:id/{command,power,websocket}`
  now enforce the user's **per-server** scope (`assertScope`) in addition to the
  token scope, and the WS token is capped to the **intersection** of token and
  server scopes.
- **Symlink path-traversal fixed.** The daemon's `safeResolve` validates the
  server-id shape and `realpath`-checks the deepest existing ancestor, so a
  planted symlink can't escape the per-server volume.
- **Arbitrary Docker image blocked.** Server creation only accepts images on the
  template's allow-list.
- **Spoofable client IP fixed.** Caddy sets a non-forgeable `X-Real-Client-IP`
  from the real socket peer; the rate limiter, API-key IP allowlist and session
  IP all prefer it over the client-controlled `X-Forwarded-For`.
- **Brute-force lockout** added per-account on login and 2FA (`lib/lockout.ts`),
  with a dedicated tight budget for `/api/auth/2fa`.
- **Recovery codes** now use higher entropy, a keyed **HMAC** (not bare SHA-256),
  and constant-time verification.
- **Constant-time token comparison** for the node bearer token (daemon + panel
  sftp-auth) and the API-key hash.
- **Container hardening**: game containers drop dangerous Linux capabilities
  (`CapDrop`) in addition to `no-new-privileges`.
- **Deploy hardening**: panel port is no longer published on the host (Caddy
  fronts it internally); daemon CORS restricted to the panel origin; the panel
  image no longer runs `prisma db push --accept-data-loss`; a request-body size
  limit is set in Caddy and on file writes; 500s no longer leak internal errors.

## Backlog (defence-in-depth, tracked)

These are hardening improvements, not active exploits given the fixes above:

- Upgrade Next.js to the latest patch / next major to clear remaining advisories.
- Session rotation on login / 2FA change and a global "revoke all sessions".
- Short-lived, scoped pre-2FA token (instead of a full 30-day cookie) + CSRF/Origin checks.
- TOTP replay protection (reject a reused time-step).
- Gate open registration / move first-admin bootstrap out of band.
- Distinct keys for the daemon HTTP bearer vs WS-JWT (HKDF-separated).
- Breached-password (HIBP) check at registration.
- Read-only rootfs + non-root user for game containers; docker-socket-proxy.
- Device-code row-growth limits + server-side poll interval; atomic wake-link `maxUses`.
- Lower the edge-proxy accepted handshake string to the realistic hostname limit.

Run a `gitleaks`/`trufflehog` pass in CI as belt-and-suspenders.
