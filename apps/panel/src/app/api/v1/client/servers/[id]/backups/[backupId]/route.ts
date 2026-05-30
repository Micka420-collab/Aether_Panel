import { db } from "@/lib/db";
import { route, noContent } from "@/lib/http";
import { HttpError } from "@/lib/auth";
import { authApi, requireApiScope } from "@/lib/api-auth";
import { getServerContext, assertScope } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";

// DELETE — remove a backup (locked backups are protected)
export const DELETE = route(async (req: Request, ctx: { params: { id: string; backupId: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "backup.delete");
  assertScope(c, "backup.delete");
  const backup = await db.backup.findFirst({ where: { id: ctx.params.backupId, serverId: c.server.id } });
  if (!backup) throw new HttpError(404, "Backup not found");
  if (backup.locked) throw new HttpError(409, "Backup is locked");
  await new DaemonClient(c.node).deleteBackup(c.server.id, backup.id).catch(() => {});
  await db.backup.delete({ where: { id: backup.id } });
  return noContent();
});
