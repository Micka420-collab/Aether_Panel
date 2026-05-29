import { cn } from "@/lib/util";

const MAP: Record<string, { label: string; dot: string; text: string }> = {
  running: { label: "Running", dot: "bg-online", text: "text-online" },
  starting: { label: "Starting", dot: "bg-warn animate-pulse-dot", text: "text-warn" },
  installing: { label: "Installing", dot: "bg-cyan animate-pulse-dot", text: "text-cyan-light" },
  stopping: { label: "Stopping", dot: "bg-warn animate-pulse-dot", text: "text-warn" },
  offline: { label: "Offline", dot: "bg-white/30", text: "text-white/50" },
  errored: { label: "Errored", dot: "bg-danger", text: "text-danger" },
  suspended: { label: "Suspended", dot: "bg-danger", text: "text-danger" },
};

export function StateBadge({ state, className }: { state: string; className?: string }) {
  const s = MAP[state] ?? MAP.offline!;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium",
        s.text,
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}
