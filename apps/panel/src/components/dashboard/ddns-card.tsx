"use client";
import { useCallback, useEffect, useState } from "react";
import { Globe, RefreshCw, Loader2, Copy, Check, CircleCheck, CircleX } from "lucide-react";
import { api } from "@/lib/client";
import { relativeTime } from "@/lib/util";

interface DdnsStatus {
  configured: boolean;
  hostname: string | null;
  lastIp: string | null;
  lastUpdateAt: number | null;
  currentIp: string | null;
}

/**
 * Admin card showing the stable DuckDNS address that follows the home IP.
 * Surfaces the hostname players use, the current public IP, and a manual
 * "Refresh now" trigger that forces an immediate DuckDNS update.
 */
export function DdnsCard() {
  const [status, setStatus] = useState<DdnsStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api<DdnsStatus>("/api/admin/ddns"));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await api<DdnsStatus & { ok: boolean; error?: string }>("/api/admin/ddns", { method: "POST" });
      if (!res.ok && res.error) setError(res.error);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  function copy() {
    if (!status?.hostname) return;
    void navigator.clipboard.writeText(status.hostname);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!status) return null;

  // Record is "in sync" when DuckDNS last ack'd the IP we currently have.
  const inSync = status.lastIp != null && status.lastIp === status.currentIp;

  return (
    <div className="glass overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 font-medium text-white">
        <Globe className="h-4 w-4 text-cyan" /> Adresse stable (DuckDNS)
      </div>

      {!status.configured ? (
        <div className="px-4 py-8 text-center text-sm text-white/40">
          DuckDNS n&apos;est pas configuré. Définis{" "}
          <code className="font-mono text-white/60">DUCKDNS_DOMAIN</code> et{" "}
          <code className="font-mono text-white/60">DUCKDNS_TOKEN</code> pour activer une adresse stable.
        </div>
      ) : (
        <div className="space-y-4 px-4 py-4">
          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
          )}

          <div>
            <div className="text-xs text-white/40">Adresse de connexion</div>
            <div className="mt-1 flex items-center gap-2">
              <code className="font-mono text-lg font-semibold text-white">{status.hostname}</code>
              <button
                onClick={copy}
                title="Copier"
                className="rounded-md p-1 text-white/40 transition hover:bg-white/10 hover:text-white"
              >
                {copied ? <Check className="h-4 w-4 text-online" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <div className="text-xs text-white/40">IP publique actuelle</div>
              <div className="mt-0.5 font-mono text-sm text-white/85">{status.currentIp ?? "inconnue"}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <div className="text-xs text-white/40">IP pointée par DuckDNS</div>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-sm text-white/85">
                {status.lastIp ?? "—"}
                {status.lastIp != null &&
                  status.currentIp != null &&
                  (inSync ? (
                    <CircleCheck className="h-3.5 w-3.5 text-online" />
                  ) : (
                    <CircleX className="h-3.5 w-3.5 text-warn" />
                  ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-white/30">
              {status.lastUpdateAt
                ? `Dernière mise à jour ${relativeTime(status.lastUpdateAt)}`
                : "Pas encore mis à jour depuis le démarrage"}
            </span>
            <button onClick={refresh} disabled={refreshing} className="btn-ghost">
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Actualiser
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
