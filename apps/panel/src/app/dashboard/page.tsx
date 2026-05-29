import Link from "next/link";
import { Plus, Cpu, MemoryStick, HardDrive, ServerOff } from "lucide-react";
import { getTemplate, buildAddress } from "@aether/shared";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { StateBadge } from "@/components/dashboard/state-badge";
import { formatBytes } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const user = await requireUser();
  const servers = await db.server.findMany({
    where: { OR: [{ ownerId: user.id }, { subusers: { some: { userId: user.id } } }] },
    include: { allocations: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-white">Your servers</h1>
          <p className="mt-1 text-sm text-white/50">{servers.length} server{servers.length === 1 ? "" : "s"} · welcome back, {user.username}.</p>
        </div>
        <Link href="/dashboard/new" className="btn-primary hidden sm:inline-flex">
          <Plus className="h-4 w-4" /> New server
        </Link>
      </div>

      {servers.length === 0 ? (
        <div className="glass mt-8 flex flex-col items-center justify-center px-6 py-20 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-cyan-violet/15 text-cyan">
            <ServerOff className="h-7 w-7" />
          </div>
          <h2 className="mt-5 font-display text-xl font-semibold text-white">No servers yet</h2>
          <p className="mt-2 max-w-sm text-sm text-white/50">
            Deploy your first Minecraft, Icarus or other game server. It&apos;ll be online in under a minute.
          </p>
          <Link href="/dashboard/new" className="btn-primary mt-6">
            <Plus className="h-4 w-4" /> Create a server
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((s) => {
            const tpl = getTemplate(s.templateId);
            const primary = s.allocations.find((a) => a.primary) ?? s.allocations[0];
            const defaultPort = tpl?.ports.find((p) => p.primary)?.default ?? primary?.port ?? 0;
            const address = primary ? buildAddress(primary.ip, primary.port, defaultPort) : "—";
            return (
              <Link
                key={s.id}
                href={`/dashboard/servers/${s.id}`}
                className="group glass p-5 transition hover:border-white/20 hover:bg-white/[0.07]"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-black/30 text-xl">
                      {tpl?.icon ?? "🎮"}
                    </span>
                    <div>
                      <h3 className="font-display font-semibold text-white">{s.name}</h3>
                      <p className="text-xs text-white/40">{tpl?.name ?? s.templateId}</p>
                    </div>
                  </div>
                  <StateBadge state={s.state} />
                </div>
                <div className="mt-4 rounded-lg border border-white/5 bg-black/20 px-3 py-2 font-mono text-xs text-cyan-light">
                  {address}
                </div>
                <div className="mt-4 flex items-center gap-4 text-xs text-white/45">
                  <span className="flex items-center gap-1.5"><MemoryStick className="h-3.5 w-3.5" /> {formatBytes(s.memoryMb * 1024 * 1024, 0)}</span>
                  <span className="flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /> {s.cpuPercent}%</span>
                  <span className="flex items-center gap-1.5"><HardDrive className="h-3.5 w-3.5" /> {formatBytes(s.diskMb * 1024 * 1024, 0)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
