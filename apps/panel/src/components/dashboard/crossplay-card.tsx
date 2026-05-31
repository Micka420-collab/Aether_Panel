"use client";
import { useEffect, useState } from "react";
import { Smartphone, Loader2, Copy, Check, Gamepad2, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/client";

interface CrossplayState {
  enabled: boolean;
  floodgate: boolean;
  bedrockAddress: string | null;
  bedrockPort: number;
  supported: boolean;
  loader: string | null;
  game: string;
}

/**
 * Toggle card to enable Java <-> Bedrock crossplay (Geyser + Floodgate).
 * Lets Bedrock players (mobile / console / Windows) join a Java server on the
 * Bedrock UDP port (19132). Surface it in the Network tab. Gated on
 * `startup.update`, so only pass `canStartup` when the user holds that scope.
 */
export function CrossplayCard({ id, canStartup = true }: { id: string; canStartup?: boolean }) {
  const [state, setState] = useState<CrossplayState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () =>
    api<CrossplayState>(`/api/servers/${id}/crossplay`)
      .then(setState)
      .catch(() => {});

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Only relevant for Minecraft Java servers.
  if (!state || state.game !== "minecraft") return null;

  async function toggle(enable: boolean) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await api<CrossplayState>(`/api/servers/${id}/crossplay`, {
        method: enable ? "POST" : "DELETE",
      });
      setState((s) => (s ? { ...s, ...res } : s));
      await load();
      setMsg(
        enable
          ? "Crossplay enabled. Restart the server, then Bedrock players can join on the address below."
          : "Crossplay disabled. Restart to remove the Bedrock listener.",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const on = state.enabled;

  return (
    <div className="glass p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-display font-semibold text-white">
            <Smartphone className="h-4 w-4 text-cyan" /> Bedrock crossplay
          </h3>
          <p className="mt-1 max-w-prose text-sm text-white/45">
            Let <span className="text-white/70">Bedrock</span> players — mobile, console and Windows 10 — join this Java
            server. We install <span className="text-white/70">Geyser</span> + <span className="text-white/70">Floodgate</span>{" "}
            and open the Bedrock port <span className="font-mono text-white/70">{state.bedrockPort}</span> (UDP). No Java
            account needed for Bedrock players.
          </p>
        </div>
        <Toggle
          on={on}
          disabled={busy || !canStartup || !state.supported}
          onClick={() => toggle(!on)}
        />
      </div>

      {busy && (
        <div className="mt-3 flex items-center gap-2 text-xs text-cyan-light">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying…
        </div>
      )}

      {!state.supported && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Crossplay needs a plugin/mod-capable server (Paper, Purpur, Spigot, Fabric, NeoForge…).
            {state.loader ? ` Your server runs ${state.loader}.` : ""} Change the server software in Settings first.
          </span>
        </div>
      )}

      {error && <div className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {msg && <div className="mt-3 rounded-xl border border-online/30 bg-online/10 px-3 py-2 text-sm text-online">{msg}</div>}

      {on && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-white/70">
            <CheckCircle2 className="h-4 w-4 text-online" /> Geyser installed
            {state.floodgate && (
              <>
                <span className="text-white/20">·</span>
                <CheckCircle2 className="h-4 w-4 text-online" /> Floodgate (no-account login)
              </>
            )}
          </div>
          {state.bedrockAddress && (
            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/35">
                <Gamepad2 className="h-3.5 w-3.5" /> Bedrock connect address
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="flex-1 truncate font-mono text-sm text-cyan-light">{state.bedrockAddress}</span>
                <button onClick={() => copy(state.bedrockAddress!)} className="text-white/40 hover:text-white">
                  {copied ? <Check className="h-4 w-4 text-online" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-2 text-xs text-white/40">
                In Minecraft Bedrock, add a server with this IP and the port shown after the colon. Java players keep
                using the normal address.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className="relative h-6 w-11 shrink-0 rounded-full border border-white/15 bg-white/5 transition disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${on ? "left-6 bg-cyan-violet" : "left-0.5 bg-white/40"}`} />
    </button>
  );
}
