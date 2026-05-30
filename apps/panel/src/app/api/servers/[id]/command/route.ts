import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";

const schema = z.object({ command: z.string().min(1).max(2000) });

export const POST = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  const { command } = schema.parse(await req.json());
  assertScope(c, "control.command");
  assertNotSuspended(c);
  await new DaemonClient(c.node).command(c.server.id, command);
  return json({ ok: true });
});
