import { db } from "@/lib/db";
import { route, json } from "@/lib/http";
import { HttpError } from "@/lib/auth";
import { authApi, requireApiScope } from "@/lib/api-auth";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";
import { audit } from "@/lib/audit";

// POST — restore a backup (stops the server first; the node swaps files atomically)
export const POST = route(async (req: Request, ctx: { params: { id: string; backupId: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "backup.restore");
  assertScope(c, "backup.restore");
  assertNotSuspended(c);
  const backup = await db.backup.findFirst({ where: { id: ctx.params.backupId, serverId: c.server.id } });
  if (!backup) throw new HttpError(404, "Backup not found");
  const client = new DaemonClient(c.node);
  await client.power(c.server.id, "stop").catch(() => {});
  await client.restoreBackup(c.server.id, backup.id);
  await audit("backup.restore", { userId: principal.user.id, serverId: c.server.id, metadata: { backupId: backup.id, via: principal.via } });
  return json({ ok: true });
});
