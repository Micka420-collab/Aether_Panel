import { z } from "zod";
import { route, json } from "@/lib/http";
import { authApi, requireApiScope } from "@/lib/api-auth";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { changePrimaryPort } from "@/lib/allocation";
import { audit } from "@/lib/audit";

const schema = z.object({ port: z.number().int().min(1024).max(65535) });

// PATCH — change the server's primary (game) port over the API.
export const PATCH = route(async (req: Request, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "allocation.update");
  assertScope(c, "allocation.update");
  assertNotSuspended(c);
  const { port } = schema.parse(await req.json());
  await changePrimaryPort(c, port);
  await audit("allocation.update", { userId: principal.user.id, serverId: c.server.id, metadata: { port, via: principal.via } });
  return json({ ok: true, port });
});
