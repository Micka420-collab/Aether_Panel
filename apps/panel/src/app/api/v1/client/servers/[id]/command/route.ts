import { z } from "zod";
import { route } from "@/lib/http";
import { authApi, requireApiScope } from "@/lib/api-auth";
import { getServerContext } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";

const schema = z.object({ command: z.string().min(1).max(2000) });

export const POST = route(async (req, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  const { command } = schema.parse(await req.json());
  requireApiScope(principal, "control.command");
  await new DaemonClient(c.node).command(c.server.id, command);
  return new Response(null, { status: 204 });
});
