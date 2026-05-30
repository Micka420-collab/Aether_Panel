import { z } from "zod";
import { db } from "@/lib/db";
import { route, json } from "@/lib/http";
import { authApi, requireApiScope } from "@/lib/api-auth";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";
import { audit } from "@/lib/audit";

const schema = z.object({ signal: z.enum(["start", "stop", "restart", "kill"]) });

export const POST = route(async (req, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  const { signal } = schema.parse(await req.json());
  const scope = signal === "start" ? "control.start" : "control.stop";
  requireApiScope(principal, scope);
  assertScope(c, scope);
  if (signal === "start" || signal === "restart") assertNotSuspended(c);

  await new DaemonClient(c.node).power(c.server.id, signal);
  await db.server.update({
    where: { id: c.server.id },
    data: { state: signal === "start" || signal === "restart" ? "starting" : "stopping" },
  });
  await audit("server.power", { userId: principal.user.id, serverId: c.server.id, metadata: { signal, via: principal.via } });
  return new Response(null, { status: 204 });
});
