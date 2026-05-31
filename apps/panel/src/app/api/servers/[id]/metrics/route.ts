import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { db } from "@/lib/db";

const query = z.object({
  // Window length in hours (default 6h, capped at the 7-day retention window).
  hours: z.coerce.number().min(1).max(168).default(6),
});

export interface MetricPoint {
  ts: number;
  cpu: number;
  memMb: number;
  players: number;
}

/**
 * Historical resource samples for the server's "Stats" tab. Read-only, so it's
 * gated on console-view access. Returns points oldest-first within the window.
 */
export const GET = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "control.console");

  const { hours } = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const rows = await db.serverStat.findMany({
    where: { serverId: c.server.id, ts: { gte: since } },
    orderBy: { ts: "asc" },
    select: { ts: true, cpu: true, memMb: true, players: true },
    take: 5000,
  });

  const points: MetricPoint[] = rows.map((r) => ({
    ts: r.ts.getTime(),
    cpu: r.cpu,
    memMb: r.memMb,
    players: r.players,
  }));

  return json({ points });
});
