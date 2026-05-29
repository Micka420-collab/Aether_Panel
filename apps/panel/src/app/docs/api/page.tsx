function Endpoint({ method, path, desc }: { method: string; path: string; desc: string }) {
  const color =
    method === "GET" ? "text-online" : method === "DELETE" ? "text-danger" : "text-cyan-light";
  return (
    <div className="flex flex-col gap-1 border-b border-white/5 py-2.5 sm:flex-row sm:items-center sm:gap-4">
      <span className={`w-16 shrink-0 font-mono text-xs font-bold ${color}`}>{method}</span>
      <code className="font-mono text-[13px] text-white/85">{path}</code>
      <span className="text-sm text-white/45 sm:ml-auto">{desc}</span>
    </div>
  );
}

const GROUPS = [
  {
    title: "Auth (session cookie)",
    items: [
      ["POST", "/api/auth/register", "Create account (first = admin)"],
      ["POST", "/api/auth/login", "Email + password → session"],
      ["POST", "/api/auth/2fa", "Complete TOTP challenge"],
      ["POST", "/api/auth/logout", "Destroy session"],
    ],
  },
  {
    title: "Servers (dashboard)",
    items: [
      ["GET", "/api/servers", "List your servers"],
      ["POST", "/api/servers", "Create + provision a server"],
      ["GET", "/api/servers/{id}", "Detail + live status"],
      ["PATCH", "/api/servers/{id}", "Rename / edit variables"],
      ["DELETE", "/api/servers/{id}", "Destroy server"],
      ["POST", "/api/servers/{id}/power", "start | stop | restart | kill"],
      ["POST", "/api/servers/{id}/command", "Send console command"],
      ["GET", "/api/servers/{id}/ws-token", "Mint live console token"],
    ],
  },
  {
    title: "Files & backups",
    items: [
      ["GET", "/api/servers/{id}/files", "List a directory"],
      ["GET", "/api/servers/{id}/files/content", "Read a file"],
      ["PUT", "/api/servers/{id}/files", "Write a file"],
      ["POST", "/api/servers/{id}/files", "mkdir / rename"],
      ["DELETE", "/api/servers/{id}/files", "Delete a path"],
      ["GET", "/api/servers/{id}/backups", "List backups"],
      ["POST", "/api/servers/{id}/backups", "Create a backup"],
      ["POST", "/api/servers/{id}/backups/{bid}", "Restore"],
      ["DELETE", "/api/servers/{id}/backups/{bid}", "Delete a backup"],
    ],
  },
  {
    title: "Account & admin",
    items: [
      ["POST", "/api/account/2fa/setup", "Begin 2FA enrolment"],
      ["POST", "/api/account/2fa/enable", "Confirm + get recovery codes"],
      ["GET", "/api/account/api-keys", "List API keys"],
      ["POST", "/api/account/api-keys", "Create API key"],
      ["GET", "/api/admin/nodes", "List nodes + health (admin)"],
      ["POST", "/api/admin/nodes", "Register a node (admin)"],
    ],
  },
];

export default function ApiDocs() {
  return (
    <div className="space-y-6 text-white/70">
      <h1 className="font-display text-4xl font-bold text-white">REST API</h1>
      <p className="text-lg text-white/55">
        The dashboard endpoints use your session cookie. For automation and launchers, use the versioned{" "}
        <code>/api/v1</code> surface with a bearer API key — see the Launcher API page.
      </p>
      {GROUPS.map((g) => (
        <div key={g.title} className="glass px-5 py-3">
          <h2 className="py-2 font-display text-lg font-semibold text-white">{g.title}</h2>
          {g.items.map(([m, p, d]) => (
            <Endpoint key={p} method={m!} path={p!} desc={d!} />
          ))}
        </div>
      ))}
    </div>
  );
}
