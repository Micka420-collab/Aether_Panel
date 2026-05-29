function Code({ children }: { children: string }) {
  return (
    <pre className="console-surface my-4 overflow-x-auto rounded-xl p-4 font-mono text-[12.5px] leading-relaxed text-console-text">
      {children}
    </pre>
  );
}
function Endpoint({ method, path, desc }: { method: string; path: string; desc: string }) {
  const color = method === "GET" ? "text-online" : "text-cyan-light";
  return (
    <div className="flex flex-col gap-1 border-b border-white/5 py-3 sm:flex-row sm:items-center sm:gap-4">
      <span className={`w-14 shrink-0 font-mono text-xs font-bold ${color}`}>{method}</span>
      <code className="font-mono text-sm text-white/85">{path}</code>
      <span className="text-sm text-white/45 sm:ml-auto">{desc}</span>
    </div>
  );
}

export default function LauncherDocs() {
  return (
    <div className="space-y-5 text-white/70">
      <h1 className="font-display text-4xl font-bold text-white">Launcher API</h1>
      <p className="text-lg text-white/55">
        Connect your custom Minecraft launcher to Aether. Authenticate a user with a device code, list the servers
        they can access, fetch live connection info, and launch the game straight into the server.
      </p>

      <h2 className="font-display text-2xl font-semibold text-white">1 · Authenticate (device code)</h2>
      <p>
        The launcher never handles raw credentials. It starts a device-code flow, shows the user a short code, and
        polls until they approve it in the panel.
      </p>
      <Code>{`// Start
POST /api/v1/auth/device/start
→ {
    "device_code": "…",
    "user_code": "AB12-CD34",
    "verification_uri": "https://your-host/link",
    "interval": 5,
    "expires_in": 600
  }

// Show user_code + verification_uri, then poll:
POST /api/v1/auth/device/poll  { "device_code": "…" }
→ 202 { "status": "authorization_pending" }      // keep polling every \`interval\`s
→ 200 {                                           // once approved
    "token_type": "Bearer",
    "access_token": "…",   // use as: Authorization: Bearer <access_token>
    "refresh_token": "…",  // store securely (OS keychain)
    "expires_in": 3600,
    "profile": { "id": "…", "name": "Steve", "uuid": null }
  }

// Later, refresh the short-lived access token:
POST /api/v1/auth/refresh  { "refresh_token": "…" }`}</Code>

      <h2 className="font-display text-2xl font-semibold text-white">2 · List servers & connect</h2>
      <Code>{`GET /api/v1/client
→ { "servers": [{ "id", "name", "game", "state", "address", "owner" }] }

GET /api/v1/client/servers/{id}/connection
→ {
    "address": "play.aether.host",
    "host": "play.aether.host",
    "port": 25565,
    "game": "minecraft",
    "state": "running",
    "players": { "online": 3, "max": 40 },
    "version": "1.21.4",
    "motd": "Powered by Aether"
  }`}</Code>

      <h2 className="font-display text-2xl font-semibold text-white">3 · Power & live console</h2>
      <Code>{`POST /api/v1/client/servers/{id}/power    { "signal": "start" }   → 204
POST /api/v1/client/servers/{id}/command  { "command": "say hi" } → 204

// Live console / stats over WebSocket:
GET  /api/v1/client/servers/{id}/websocket
→ { "token": "<jwt>", "socket": "ws://node:8080/api/servers/{id}/ws" }
// connect, then send { "type": "auth", "token": "<jwt>" }`}</Code>

      <h2 className="font-display text-2xl font-semibold text-white">Endpoint reference</h2>
      <div className="glass mt-3 px-5 py-2">
        <Endpoint method="POST" path="/api/v1/auth/device/start" desc="Begin device-code login" />
        <Endpoint method="POST" path="/api/v1/auth/device/poll" desc="Poll for approval → tokens" />
        <Endpoint method="POST" path="/api/v1/auth/refresh" desc="Refresh access token" />
        <Endpoint method="GET" path="/api/v1/auth/me" desc="Current user profile" />
        <Endpoint method="GET" path="/api/v1/client" desc="List accessible servers" />
        <Endpoint method="GET" path="/api/v1/client/servers/{id}" desc="Server detail" />
        <Endpoint method="GET" path="/api/v1/client/servers/{id}/connection" desc="ip:port + status for auto-join" />
        <Endpoint method="GET" path="/api/v1/client/servers/{id}/resources" desc="Live CPU/RAM/players" />
        <Endpoint method="POST" path="/api/v1/client/servers/{id}/power" desc="start | stop | restart | kill" />
        <Endpoint method="POST" path="/api/v1/client/servers/{id}/command" desc="Send a console command" />
        <Endpoint method="GET" path="/api/v1/client/servers/{id}/websocket" desc="Mint a live console token" />
        <Endpoint method="POST" path="/api/v1/client/servers/{id}/wake-link" desc="Create a no-login wake link" />
      </div>
      <p className="text-sm text-white/45">
        API keys (created in your account) also work as bearer tokens. Keys carry scopes; tokens are capped to those
        scopes. Power needs <code>control.start</code>/<code>control.stop</code>, commands need{" "}
        <code>control.command</code>.
      </p>
    </div>
  );
}
