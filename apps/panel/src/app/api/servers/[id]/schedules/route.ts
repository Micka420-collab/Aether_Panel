import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { isValidCron, nextRun } from "@/lib/scheduler";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "schedule.read");
  const schedules = await db.schedule.findMany({
    where: { serverId: c.server.id },
    include: { tasks: { orderBy: { sequence: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return json({ schedules });
});

const schema = z.object({
  name: z.string().min(1).max(60),
  cron: z.string().min(1).max(120),
  timezone: z.string().max(64).optional(),
  tasks: z
    .array(
      z.object({
        action: z.enum(["POWER", "COMMAND", "BACKUP"]),
        payload: z.string().max(2000).default(""),
        offsetSeconds: z.number().int().min(0).max(86400).default(0),
        continueOnFailure: z.boolean().default(true),
      }),
    )
    .min(1),
});

export const POST = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "schedule.update");
  const body = schema.parse(await req.json());
  const tz = body.timezone || "UTC";
  if (!isValidCron(body.cron, tz)) throw new HttpError(422, "Invalid cron expression");

  const schedule = await db.schedule.create({
    data: {
      serverId: c.server.id,
      name: body.name,
      cron: body.cron,
      timezone: tz,
      nextRunAt: nextRun(body.cron, tz),
      tasks: {
        create: body.tasks.map((t, i) => ({
          action: t.action,
          payload: t.payload,
          offsetSeconds: t.offsetSeconds,
          sequence: i,
          continueOnFailure: t.continueOnFailure,
        })),
      },
    },
  });
  await audit("schedule.create", { userId: user.id, serverId: c.server.id, metadata: { name: body.name, cron: body.cron } });
  return json({ id: schedule.id }, 201);
});
