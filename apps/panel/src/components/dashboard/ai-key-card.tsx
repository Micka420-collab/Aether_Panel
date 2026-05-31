"use client";
import { useCallback, useEffect, useState } from "react";
import { Sparkles, Loader2, Check, Trash2, KeyRound } from "lucide-react";
import { api } from "@/lib/client";

interface AiStatus {
  configured: boolean;
  source: "db" | "env" | null;
  masked: string | null;
  validationWarning?: string;
}

/**
 * Admin card to connect an Anthropic API key for the AI Copilot straight from the
 * dashboard — no code/.env edit needed. The key is validated against Anthropic,
 * stored encrypted, and never returned to the browser (only a masked fingerprint).
 */
export function AiKeyCard() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<AiStatus>("/api/admin/ai"));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setBusy("save");
    setError(null);
    setSaved(false);
    setWarning(null);
    try {
      const res = await api<AiStatus>("/api/admin/ai", { method: "PUT", json: { apiKey: value.trim() } });
      setStatus(res);
      setValue("");
      setWarning(res.validationWarning ?? null);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    setError(null);
    try {
      setStatus(await api<AiStatus>("/api/admin/ai", { method: "DELETE" }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (!status) return null;

  return (
    <div className="glass overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 font-medium text-white">
        <Sparkles className="h-4 w-4 text-cyan" /> Copilot IA — clé Anthropic
      </div>

      <div className="space-y-4 px-4 py-4">
        {error && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
        )}
        {saved && !warning && (
          <div className="flex items-center gap-2 rounded-xl border border-online/30 bg-online/10 px-3 py-2 text-sm text-online">
            <Check className="h-4 w-4" /> Clé validée et enregistrée. Le Copilot répond maintenant en IA complète.
          </div>
        )}
        {warning && (
          <div className="rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">{warning}</div>
        )}

        {/* status line */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {status.configured ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-online/30 bg-online/10 px-2.5 py-1 text-xs font-medium text-online">
                <Check className="h-3.5 w-3.5" /> Active
              </span>
              <span className="font-mono text-white/70">{status.masked}</span>
              <span className="text-xs text-white/40">
                {status.source === "db" ? "· définie depuis le dashboard" : "· depuis ANTHROPIC_API_KEY (env)"}
              </span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-xs text-white/60">
              Non configurée — le Copilot tourne en mode hors-ligne (règles)
            </span>
          )}
        </div>

        <p className="text-xs text-white/45">
          Colle une clé API Anthropic (<code className="font-mono text-white/60">sk-ant-…</code>) pour activer les réponses
          IA complètes du Copilot, sur tous les serveurs. La clé est vérifiée auprès d&apos;Anthropic puis stockée chiffrée —
          elle n&apos;est jamais renvoyée au navigateur. Obtiens-la sur{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-cyan-light hover:text-cyan">
            console.anthropic.com
          </a>.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={status.configured ? "Remplacer la clé… (sk-ant-…)" : "sk-ant-…"}
              className="input pl-9 font-mono"
            />
          </div>
          <button onClick={save} disabled={busy !== null || value.trim().length < 8} className="btn-primary">
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {status.configured ? "Remplacer" : "Connecter"}
          </button>
          {status.configured && status.source === "db" && (
            <button onClick={remove} disabled={busy !== null} className="btn-ghost text-danger">
              {busy === "remove" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Retirer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
