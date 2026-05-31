"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Stethoscope,
  Loader2,
  RefreshCw,
  AlertOctagon,
  AlertTriangle,
  Info,
  ShieldOff,
  RotateCcw,
  CheckCircle2,
  PackageX,
} from "lucide-react";
import { api } from "@/lib/client";
import { cn } from "@/lib/util";

type Level = "error" | "warn" | "info";

interface Issue {
  level: Level;
  file: string;
  kind: string;
  message: string;
  fix?: "quarantine";
  related?: string[];
}

interface Report {
  issues: Issue[];
  summary: {
    scanned: number;
    jars: number;
    errors: number;
    warnings: number;
    infos: number;
    loader: string | null;
    mcVersion: string | null;
    kind: "mods" | "plugins";
  };
  dir: string;
  quarantineDir: string;
  quarantined: string[];
  canFix: boolean;
}

const LEVEL_META: Record<Level, { icon: any; ring: string; text: string; label: string }> = {
  error: { icon: AlertOctagon, ring: "border-danger/30 bg-danger/10", text: "text-danger", label: "Error" },
  warn: { icon: AlertTriangle, ring: "border-amber-400/25 bg-amber-400/10", text: "text-amber-200", label: "Warning" },
  info: { icon: Info, ring: "border-white/10 bg-white/5", text: "text-white/55", label: "Info" },
};

/**
 * Mod Conflict Doctor panel. Scans the server's mods/ or plugins/ folder and
 * lists problems (duplicate jars, client-only mods, loader/version mismatches,
 * missing deps) with per-file quarantine/restore actions. `canFix` enables the
 * move buttons; without it the report is read-only. Match the Sci-Fi Lab look.
 */
export function ModDoctorPanel({ id, canFix = false }: { id: string; canFix?: boolean }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await api<Report>(`/api/servers/${id}/mod-doctor`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(file: string, action: "quarantine" | "restore") {
    setBusy(file);
    setError(null);
    setMsg(null);
    try {
      await api(`/api/servers/${id}/mod-doctor`, { method: "POST", json: { files: [file], action } });
      setMsg(
        action === "quarantine"
          ? `Quarantined "${file}". It moves out of the way on the next start — restore anytime.`
          : `Restored "${file}". It loads again on the next start.`,
      );
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (loading && !report) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-cyan" />
      </div>
    );
  }

  const allow = canFix && (report?.canFix ?? false);

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="glass p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 font-display font-semibold text-white">
              <Stethoscope className="h-4 w-4 text-cyan" /> Mod Conflict Doctor
            </h3>
            <p className="mt-1 max-w-prose text-sm text-white/45">
              Scans your <span className="font-mono text-white/70">{report?.dir ?? "mods"}/</span> folder for duplicate
              jars, client-only mods, wrong-loader builds and version mismatches. Quarantine is{" "}
              <span className="text-white/70">non-destructive</span> — flagged jars move to{" "}
              <span className="font-mono text-white/70">{report?.quarantineDir ?? "mods/.disabled"}/</span> and can be
              restored anytime.
            </p>
          </div>
          <button onClick={load} disabled={loading} className="btn-ghost shrink-0 disabled:opacity-40">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Rescan
          </button>
        </div>

        {report && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Stat icon={PackageX} label={`${report.summary.jars} jars`} tone="text-white/60" />
            <Stat icon={AlertOctagon} label={`${report.summary.errors} errors`} tone="text-danger" />
            <Stat icon={AlertTriangle} label={`${report.summary.warnings} warnings`} tone="text-amber-200" />
            {report.summary.loader && (
              <Stat icon={Info} label={`${report.summary.loader}${report.summary.mcVersion ? ` · ${report.summary.mcVersion}` : ""}`} tone="text-cyan-light" />
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
      )}
      {msg && (
        <div className="rounded-xl border border-online/30 bg-online/10 px-3 py-2 text-sm text-online">{msg}</div>
      )}

      {/* clean state */}
      {report && report.issues.length === 0 && (
        <div className="glass flex items-center gap-3 p-6 text-sm text-white/70">
          <CheckCircle2 className="h-5 w-5 text-online" />
          No conflicts found. Your {report.summary.kind} look healthy.
        </div>
      )}

      {/* issues */}
      {report && report.issues.length > 0 && (
        <div className="space-y-2">
          {report.issues.map((issue, i) => {
            const meta = LEVEL_META[issue.level];
            const Icon = meta.icon;
            const isQuarantined = issue.kind === "disabled";
            return (
              <div
                key={`${issue.file}-${issue.kind}-${i}`}
                className={cn("glass-raised flex items-start gap-3 rounded-xl border p-4", meta.ring)}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.text)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm text-white/85">{issue.file}</span>
                    <span className={cn("rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide", meta.text)}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-white/55">{issue.message}</p>
                </div>

                {/* actions */}
                {allow && isQuarantined && (
                  <button
                    onClick={() => act(issue.file, "restore")}
                    disabled={busy === issue.file}
                    className="btn-ghost shrink-0 disabled:opacity-40"
                  >
                    {busy === issue.file ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    Restore
                  </button>
                )}
                {allow && !isQuarantined && issue.fix === "quarantine" && (
                  <button
                    onClick={() => act(issue.file, "quarantine")}
                    disabled={busy === issue.file}
                    className="btn-ghost shrink-0 text-amber-200 disabled:opacity-40"
                  >
                    {busy === issue.file ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
                    Quarantine
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {report && !allow && report.issues.some((i) => i.fix) && (
        <p className="text-xs text-white/35">
          You can view conflicts but need the <span className="text-white/55">startup.update</span> or{" "}
          <span className="text-white/55">file.write</span> permission to quarantine or restore jars.
        </p>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, tone }: { icon: any; label: string; tone: string }) {
  return (
    <span className={cn("flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1", tone)}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </span>
  );
}
