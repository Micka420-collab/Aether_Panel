import { MemoryStick, Server } from "lucide-react";

/** Host RAM usage + how many servers are running — so you can manage "one at a time". */
export function NodeResources({ totalMb, availableMb, running }: { totalMb: number; availableMb: number; running: number }) {
  const usedMb = Math.max(0, totalMb - availableMb);
  const pct = totalMb > 0 ? Math.min(100, Math.round((usedMb / totalMb) * 100)) : 0;
  const gb = (mb: number) => (mb / 1024).toFixed(1);
  const bar = pct > 90 ? "bg-danger" : pct > 75 ? "bg-warn" : "bg-cyan";
  return (
    <div className="glass mt-6 flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        <MemoryStick className="h-4 w-4 text-cyan" /> RAM du node
      </div>
      <div className="flex-1">
        <div className="mb-1 flex justify-between text-xs text-white/50">
          <span>{gb(usedMb)} / {gb(totalMb)} GB utilisés</span>
          <span className={availableMb < 1024 ? "text-warn" : ""}>{gb(availableMb)} GB libres</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-white/60">
        <Server className="h-3.5 w-3.5 text-online" /> {running} en ligne
      </div>
    </div>
  );
}
