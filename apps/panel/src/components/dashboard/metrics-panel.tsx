"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Cpu, MemoryStick, Users, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/client";
import { cn } from "@/lib/util";

interface MetricPoint {
  ts: number;
  cpu: number;
  memMb: number;
  players: number;
}

const RANGES: { label: string; hours: number }[] = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
];

export function MetricsPanel({ id }: { id: string }) {
  const [points, setPoints] = useState<MetricPoint[] | null>(null);
  const [hours, setHours] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await api<{ points: MetricPoint[] }>(`/api/servers/${id}/metrics?hours=${hours}`);
      setPoints(data.points);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, [id, hours]);

  useEffect(() => {
    setPoints(null);
    load();
    const t = setInterval(load, 30_000); // live-ish: refresh every 30s
    return () => clearInterval(t);
  }, [load]);

  const latest = points && points.length ? points[points.length - 1] : null;

  const charts = useMemo(
    () => [
      {
        key: "cpu",
        label: "CPU",
        icon: Cpu,
        color: "#22B8D8",
        unit: "%",
        values: (points ?? []).map((p) => p.cpu),
        format: (v: number) => `${v.toFixed(0)}%`,
        current: latest ? `${latest.cpu.toFixed(0)}%` : "—",
        // CPU is a percentage of the limit; pin the axis to 100 so spikes read true.
        fixedMax: 100,
      },
      {
        key: "mem",
        label: "RAM",
        icon: MemoryStick,
        color: "#7C5CFF",
        unit: " MB",
        values: (points ?? []).map((p) => p.memMb),
        format: (v: number) => `${Math.round(v)} MB`,
        current: latest ? `${Math.round(latest.memMb)} MB` : "—",
      },
      {
        key: "players",
        label: "Players",
        icon: Users,
        color: "#34D399",
        unit: "",
        values: (points ?? []).map((p) => p.players),
        format: (v: number) => `${Math.round(v)}`,
        current: latest ? `${latest.players}` : "—",
      },
    ],
    [points, latest],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-white/50">
          <Activity className="h-4 w-4 text-cyan" />
          Resource history
          {refreshing && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan" />}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-black/20 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.hours}
                onClick={() => setHours(r.hours)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition",
                  hours === r.hours ? "bg-white/10 text-white" : "text-white/40 hover:text-white",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            title="Refresh"
            className="rounded-lg border border-white/10 bg-black/20 p-1.5 text-white/40 transition hover:text-white"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
      )}

      {points === null ? (
        <div className="flex h-48 items-center justify-center glass">
          <Loader2 className="h-6 w-6 animate-spin text-cyan" />
        </div>
      ) : points.length === 0 ? (
        <div className="glass flex h-48 flex-col items-center justify-center gap-2 text-center">
          <Activity className="h-7 w-7 text-white/20" />
          <p className="text-sm text-white/50">No metrics recorded yet.</p>
          <p className="max-w-xs text-xs text-white/30">
            Samples are collected every minute while the server is running. Check back shortly.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {charts.map((c) => (
            <Sparkline
              key={c.key}
              label={c.label}
              icon={c.icon}
              color={c.color}
              current={c.current}
              values={c.values}
              fixedMax={c.fixedMax}
              format={c.format}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Dependency-free area + line chart drawn as inline SVG (no chart library). */
function Sparkline({
  label,
  icon: Icon,
  color,
  current,
  values,
  fixedMax,
  format,
}: {
  label: string;
  icon: any;
  color: string;
  current: string;
  values: number[];
  fixedMax?: number;
  format: (v: number) => string;
}) {
  const W = 320;
  const H = 96;
  const PAD = 4;

  const { line, area, peak } = useMemo(() => {
    if (values.length === 0) return { line: "", area: "", peak: 0 };
    const max = Math.max(fixedMax ?? 0, ...values, 1); // never divide by zero
    const peakVal = Math.max(...values);
    const innerW = W - PAD * 2;
    const innerH = H - PAD * 2;
    const n = values.length;
    const x = (i: number) => PAD + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = (v: number) => PAD + innerH - (Math.min(v, max) / max) * innerH;

    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const linePath = `M${pts.join(" L")}`;
    const areaPath =
      `M${x(0).toFixed(1)},${(H - PAD).toFixed(1)} ` +
      `L${pts.join(" L")} ` +
      `L${x(n - 1).toFixed(1)},${(H - PAD).toFixed(1)} Z`;
    return { line: linePath, area: areaPath, peak: peakVal };
  }, [values, fixedMax]);

  const gradId = `grad-${label.replace(/\s+/g, "")}`;

  return (
    <div className="glass p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-white/45">
          <Icon className="h-3.5 w-3.5" style={{ color }} />
          {label}
        </div>
        <div className="font-display text-sm font-semibold text-white">{current}</div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-3 h-24 w-full overflow-visible"
        role="img"
        aria-label={`${label} over time`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* baseline grid */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        {area && <path d={area} fill={`url(#${gradId})`} />}
        {line && (
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="mt-2 flex justify-between text-[10px] text-white/25">
        <span>{values.length} pts</span>
        <span>peak {format(peak)}</span>
      </div>
    </div>
  );
}
