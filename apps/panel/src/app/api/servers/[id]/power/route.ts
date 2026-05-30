import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";
import { audit } from "@/lib/audit";

const schema = z.object({ action: z.enum(["start", "stop", "restart", "kill"]) });

export const POST = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  const { action } = schema.parse(await req.json());
  assertScope(c, action === "start" ? "control.start" : "control.stop");
  // A suspended server may be stopped/killed but not (re)started.
  if ((action === "start" || action === "restart") && c.server.suspended) {
    throw new HttpError(403, "This server is suspended — starting it is disabled.");
  }

  await new DaemonClient(c.node).power(c.server.id, action);

  const optimistic = action === "start" || action === "restart" ? "starting" : "stopping";
  await db.server.update({ where: { id: c.server.id }, data: { state: optimistic } });
  await audit("server.power", { userId: user.id, serverId: c.server.id, metadata: { action } });
  return json({ ok: true });
});
