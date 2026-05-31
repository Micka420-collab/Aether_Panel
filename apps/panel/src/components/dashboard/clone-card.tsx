"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, Loader2, Copy, AlertTriangle, Archive, Sparkles } from "lucide-react";
import { api } from "@/lib/client";

interface BackupRow {
  id: string;
  name: string;
  sizeBytes: number;
  completed: boolean;
  createdAt: string;
}

/**
 * Clone / branch a server (owner-only). Names a new server, optionally picks a
 * source backup to "branch from this point", and forks the source's full config
 * (template, plan/resources, startup variables, modpack). Copying the world from
 * a chosen backup is best-effort; the config-clone always succeeds. On success it
 * navigates straight to the new server.
 *
 * Gated on the SOURCE server's `backup.read` scope server-side — only render it
 * for owners (pass nothing / leave `canClone` default true inside the owner-only
 * section of settings-panel).
 */
export function CloneCard({ id, canClone = true }: { id: string; canClone?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [backups, setBackups] = useState<BackupRow[] | null>(null);
  const [fromBackupId, setFromBackupId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api<{ backups: BackupRow[] }>(`/api/servers/${id}/backups`)
      .then((r) => setBackups(r.backups.filter((b) => b.completed)))
      .catch(() => setBackups([]));
  }, [id]);

  async function clone() {
    if (!name.trim()) {
      setError("Give the new server a name.");
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await api<{ id: string; worldCopied: boolean; worldError: string | null }>(
        `/api/servers/${id}/clone`,
        { method: "POST", json: { name: name.trim(), ...(fromBackupId ? { fromBackupId } : {}) } },
      );
      if (fromBackupId && !res.worldCopied) {
        // Config cloned, but the world copy didn't take — surface it but still go.
        setMsg(
          `Server forked, but the world copy failed${res.worldError ? ` (${res.worldError})` : ""}. Opening the new server…`,
        );
        setTimeout(() => router.push(`/dashboard/servers/${res.id}`), 1400);
      } else {
        setMsg("Forked. Opening the new server…");
        router.push(`/dashboard/servers/${res.id}`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!canClone) return null;

  return (
    <div className="glass p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-white/10 bg-violet/10 p-2">
          <GitBranch className="h-4 w-4 text-violet" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-white">Clone / branch this server</h3>
          <p className="mt-1 max-w-prose text-sm text-white/45">
            Fork a brand-new server from this one — same game template, plan/resources, startup variables and modpack.
            Optionally <span className="text-white/70">branch from a backup</span> to copy the world to a fresh,
            independent server you can experiment on without touching this one.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <label className="label">New server name</label>
          <input
            className="input"
            value={name}
            maxLength={60}
            placeholder={`Copy of this server`}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="label flex items-center gap-1.5">
            <Archive className="h-3.5 w-3.5 text-white/40" /> Branch from a backup{" "}
            <span className="text-white/30">(optional)</span>
          </label>
          {backups === null ? (
            <div className="flex items-center gap-2 text-xs text-white/40">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading backups…
            </div>
          ) : backups.length === 0 ? (
            <p className="text-xs text-white/35">
              No completed backups yet. The clone will start with a fresh, empty world. Create a backup first to copy
              this world into the fork.
            </p>
          ) : (
            <select
              className="input"
              value={fromBackupId}
              onChange={(e) => setFromBackupId(e.target.value)}
            >
              <option value="" className="bg-surface">
                Empty world (config only)
              </option>
              {backups.map((b) => (
                <option key={b.id} value={b.id} className="bg-surface">
                  {b.name} · {new Date(b.createdAt).toLocaleDateString()} · {(b.sizeBytes / (1024 * 1024)).toFixed(0)} MB
                </option>
              ))}
            </select>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {msg && (
          <div className="rounded-xl border border-online/30 bg-online/10 px-3 py-2 text-sm text-online">{msg}</div>
        )}

        <button onClick={clone} disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          {fromBackupId ? "Branch from backup" : "Clone server"}
        </button>

        <p className="flex items-center gap-1.5 text-xs text-white/30">
          <Sparkles className="h-3 w-3" /> The new server is fully independent — changes there never affect this one.
        </p>
      </div>
    </div>
  );
}
