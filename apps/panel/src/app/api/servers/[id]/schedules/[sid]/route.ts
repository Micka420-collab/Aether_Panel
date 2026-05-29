import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { json, noContent, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { nextRun, tick } from "@/lib/scheduler";

async function owned(serverId: string, sid: string) {
  const s = await db.schedule.findFirst({ where: { id: sid, serverId } });
  if (!s) throw new HttpError(404, "Schedule not found");
  return s;
}

const patchSchema = z.object({ active: z.boolean().optional() });

export const PATCH = route(async (req, ctx: { params: { id: string; sid: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "schedule.update");
  const s = await owned(c.server.id, ctx.params.sid);
  const body = patchSchema.parse(await req.json());
  await db.schedule.update({
    where: { id: s.id },
    data: {
      ...(body.active !== undefined ? { active: body.active } : {}),
      // re-arm next run when (re)activated
      ...(body.active ? { nextRunAt: nextRun(s.cron, s.timezone) } : {}),
    },
  });
  return json({ ok: true });
});

export const DELETE = route(async (_req, ctx: { params: { id: string; sid: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "schedule.update");
  await owned(c.server.id, ctx.params.sid);
  await db.schedule.delete({ where: { id: ctx.params.sid } });
  return noContent();
});

// Run a schedule immediately (fires on the next tick by arming nextRunAt now).
export const POST = route(async (_req, ctx: { params: { id: string; sid: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "schedule.update");
  const s = await owned(c.server.id, ctx.params.sid);
  await db.schedule.update({ where: { id: s.id }, data: { active: true, nextRunAt: new Date() } });
  await tick().catch(() => {});
  return json({ ok: true });
});
