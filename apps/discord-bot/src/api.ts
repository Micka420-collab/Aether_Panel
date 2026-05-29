const BASE = (process.env.AETHER_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.AETHER_TOKEN ?? "";

async function call<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `API ${res.status}`);
  return data as T;
}

export interface ServerSummary {
  id: string;
  name: string;
  game: string;
  state: string;
  address: string | null;
}

export const aether = {
  servers: () => call<{ servers: ServerSummary[] }>("/api/v1/client").then((r) => r.servers),
  connection: (id: string) =>
    call<{ address: string; state: string; players?: { online: number; max: number }; version?: string }>(
      `/api/v1/client/servers/${id}/connection`,
    ),
  resources: (id: string) => call<{ state: string; resources: any; players: any }>(`/api/v1/client/servers/${id}/resources`),
  power: (id: string, signal: string) => call<void>(`/api/v1/client/servers/${id}/power`, { method: "POST", body: { signal } }),
  command: (id: string, command: string) => call<void>(`/api/v1/client/servers/${id}/command`, { method: "POST", body: { command } }),
};

/** Resolve a user-typed server reference (name or id) to a server. */
export async function resolveServer(ref: string): Promise<ServerSummary | null> {
  const servers = await aether.servers();
  const lower = ref.toLowerCase();
  return (
    servers.find((s) => s.id === ref) ??
    servers.find((s) => s.name.toLowerCase() === lower) ??
    servers.find((s) => s.id.startsWith(ref) || s.name.toLowerCase().includes(lower)) ??
    null
  );
}
