"use client";
import { useEffect, useState } from "react";
import {
  Network,
  Plus,
  Trash2,
  Loader2,
  Save,
  Server as ServerIcon,
  Star,
  AlertTriangle,
  Info,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/client";

interface Backend {
  name: string;
  address: string;
}
interface VelocityState {
  provisioned: boolean;
  servers: Backend[];
  try: string[];
  forcedHosts: Record<string, string[]>;
  message?: string;
}

/**
 * Velocity proxy network editor. Lists/adds/removes backend Minecraft servers
 * (name + host:port) and sets the default (first in the `try` order). Saves the
 * whole list back via PUT /api/servers/:id/velocity. Gated on `startup.update`
 * — pass `canManage` only when the user holds that scope.
 */
export function VelocityPanel({ id, canManage = true }: { id: string; canManage?: boolean }) {
  const [state, setState] = useState<VelocityState | null>(null);
  const [servers, setServers] = useState<Backend[]>([]);
  const [tryOrder, setTryOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newAddr, setNewAddr] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<VelocityState>(`/api/servers/${id}/velocity`);
      setState(data);
      setServers(data.servers ?? []);
      setTryOrder(data.try ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const defaultName = tryOrder[0] ?? servers[0]?.name ?? null;

  function addBackend() {
    setError(null);
    setMsg(null);
    const name = newName.trim();
    const address = newAddr.trim();
    if (!name || !address) return;
    if (!/^[A-Za-z0-9 _-]+$/.test(name)) {
      setError("Server name can only contain letters, numbers, spaces, dashes or underscores.");
      return;
    }
    if (!/^[^\s:]+:\d{1,5}$/.test(address)) {
      setError("Address must be host:port, e.g. 10.0.0.5:25565.");
      return;
    }
    if (servers.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      setError(`A backend named "${name}" already exists.`);
      return;
    }
    setServers((prev) => [...prev, { name, address }]);
    // First backend becomes the default automatically.
    setTryOrder((prev) => (prev.length === 0 ? [name] : prev));
    setNewName("");
    setNewAddr("");
  }

  function removeBackend(name: string) {
    setServers((prev) => prev.filter((s) => s.name !== name));
    setTryOrder((prev) => prev.filter((n) => n !== name));
  }

  function makeDefault(name: string) {
    // Put the chosen backend first in the try order; keep the rest after it.
    setTryOrder((prev) => [name, ...prev.filter((n) => n !== name)]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      // Ensure the default is first and only references defined backends.
      const known = new Set(servers.map((s) => s.name));
      const cleanTry = tryOrder.filter((n) => known.has(n));
      const res = await api<VelocityState & { note?: string }>(`/api/servers/${id}/velocity`, {
        method: "PUT",
        json: { servers, try: cleanTry, forcedHosts: state?.forcedHosts ?? {} },
      });
      setState((s) => (s ? { ...s, ...res } : res));
      setMsg(res.note ?? "Backend list saved.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="glass flex h-40 items-center justify-center p-5">
        <Loader2 className="h-5 w-5 animate-spin text-cyan" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="glass p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 font-display font-semibold text-white">
              <Network className="h-4 w-4 text-cyan" /> Proxy network
            </h3>
            <p className="mt-1 max-w-prose text-sm text-white/45">
              Velocity routes players from a single address to your backend Minecraft servers. Add each backend below by{" "}
              <span className="text-white/70">name</span> and{" "}
              <span className="font-mono text-white/70">host:port</span>, then mark one as the default lobby. Changes
              apply after <span className="font-mono text-white/70">/velocity reload</span> or a restart.
            </p>
          </div>
          <button onClick={load} disabled={busy} className="btn-ghost shrink-0" title="Reload from server">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl border border-cyan/20 bg-cyan/5 px-3 py-2 text-xs text-white/55">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan" />
          <span>
            Backends should run with <span className="font-mono text-white/70">ONLINE_MODE=FALSE</span> and modern
            player-info forwarding, with the proxy doing the Mojang authentication. Use the backend's internal
            host/IP and game port here.
          </span>
        </div>

        {!state?.provisioned && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{state?.message ?? "Start the proxy once so Velocity generates its config, then add backends."}</span>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
        )}
        {msg && (
          <div className="mt-3 rounded-xl border border-online/30 bg-online/10 px-3 py-2 text-sm text-online">{msg}</div>
        )}
      </div>

      {/* backend list */}
      <div className="glass p-5">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-white/80">
            <ServerIcon className="h-4 w-4 text-violet" /> Backend servers
            <span className="text-white/30">({servers.length})</span>
          </h4>
        </div>

        {servers.length === 0 ? (
          <p className="rounded-xl border border-white/5 bg-black/20 px-3 py-4 text-center text-sm text-white/35">
            No backend servers yet. Add your first one below.
          </p>
        ) : (
          <ul className="space-y-2">
            {servers.map((b) => {
              const isDefault = b.name === defaultName;
              return (
                <li
                  key={b.name}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-white">{b.name}</span>
                      {isDefault && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-cyan-light">
                          <Star className="h-3 w-3" /> Default
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-xs text-white/45">{b.address}</div>
                  </div>
                  {!isDefault && canManage && (
                    <button
                      onClick={() => makeDefault(b.name)}
                      className="text-xs text-white/40 hover:text-cyan"
                      title="Make default lobby"
                    >
                      Set default
                    </button>
                  )}
                  {canManage && (
                    <button
                      onClick={() => removeBackend(b.name)}
                      className="text-white/35 hover:text-danger"
                      title="Remove backend"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canManage && (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.3fr_auto]">
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                placeholder="lobby"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addBackend()}
              />
            </div>
            <div>
              <label className="label">Address (host:port)</label>
              <input
                className="input"
                placeholder="10.0.0.5:25565"
                value={newAddr}
                onChange={(e) => setNewAddr(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addBackend()}
              />
            </div>
            <div className="flex items-end">
              <button onClick={addBackend} className="btn-ghost w-full sm:w-auto">
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>
          </div>
        )}

        {canManage && (
          <div className="mt-5 flex items-center justify-end gap-3 border-t border-white/5 pt-4">
            <button onClick={save} disabled={busy || !state?.provisioned} className="btn-primary disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save network
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
