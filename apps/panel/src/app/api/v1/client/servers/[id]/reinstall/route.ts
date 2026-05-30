import { db } from "@/lib/db";
import { route, json } from "@/lib/http";
import { authApi, requireApiScope } from "@/lib/api-auth";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { buildServerSpec } from "@/lib/spec";
import { DaemonClient } from "@/lib/daemon";
import { audit } from "@/lib/audit";

// POST — reinstall: rebuild the container from the spec (recover a corrupt/half-updated
// server, e.g. after a bad modpack). The server's data volume is preserved.
export const POST = route(async (req: Request, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "settings.reinstall");
  assertScope(c, "settings.reinstall");
  assertNotSuspended(c);
  const spec = buildServerSpec(c.server, c.allocations);
  await db.server.update({ where: { id: c.server.id }, data: { state: "installing" } });
  await new DaemonClient(c.node).registerServer(spec, true); // rebuild = recreate container
  await audit("server.reinstall", { userId: principal.user.id, serverId: c.server.id, metadata: { via: principal.via } });
  return json({ ok: true }, 202);
});
