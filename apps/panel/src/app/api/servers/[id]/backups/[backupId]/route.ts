import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { json, noContent, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";
import { audit } from "@/lib/audit";

// Restore
export const POST = route(async (_req, ctx: { params: { id: string; backupId: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "backup.restore");
  const backup = await db.backup.findFirst({ where: { id: ctx.params.backupId, serverId: c.server.id } });
  if (!backup) throw new HttpError(404, "Backup not found");
  const client = new DaemonClient(c.node);
  // Stop the server before swapping its files out, so we don't restore into a
  // directory a live process still holds open (corruption).
  await client.power(c.server.id, "stop").catch(() => {});
  await client.restoreBackup(c.server.id, backup.id);
  await audit("backup.restore", { userId: user.id, serverId: c.server.id, metadata: { backupId: backup.id } });
  return json({ ok: true });
});

export const DELETE = route(async (_req, ctx: { params: { id: string; backupId: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "backup.delete");
  const backup = await db.backup.findFirst({ where: { id: ctx.params.backupId, serverId: c.server.id } });
  if (!backup) throw new HttpError(404, "Backup not found");
  if (backup.locked) throw new HttpError(409, "Backup is locked");
  await new DaemonClient(c.node).deleteBackup(c.server.id, backup.id).catch(() => {});
  await db.backup.delete({ where: { id: backup.id } });
  return noContent();
});
