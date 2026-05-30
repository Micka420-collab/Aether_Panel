import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { changePrimaryPort } from "@/lib/allocation";
import { audit } from "@/lib/audit";

const schema = z.object({ port: z.number().int().min(1024).max(65535) });

// PATCH — change the server's primary (game) port (rebuilds; restart to apply).
export const PATCH = route(async (req: Request, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "allocation.update");
  assertNotSuspended(c);
  const { port } = schema.parse(await req.json());
  await changePrimaryPort(c, port);
  await audit("allocation.update", { userId: user.id, serverId: c.server.id, metadata: { port } });
  return json({ ok: true, port });
});
