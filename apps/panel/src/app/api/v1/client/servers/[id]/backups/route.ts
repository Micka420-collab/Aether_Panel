import { z } from "zod";
import { db } from "@/lib/db";
import { route, json } from "@/lib/http";
import { authApi, requireApiScope } from "@/lib/api-auth";
import { getServerContext, assertScope, assertNotSuspended } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";
import { enforceBackupRetention } from "@/lib/backups";
import { audit } from "@/lib/audit";

// GET — list backups
export const GET = route(async (req: Request, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "backup.read");
  assertScope(c, "backup.read");
  const backups = await db.backup.findMany({ where: { serverId: c.server.id }, orderBy: { createdAt: "desc" } });
  return json({
    backups: backups.map((b) => ({
      id: b.id,
      name: b.name,
      sizeBytes: Number(b.sizeBytes),
      checksum: b.checksum,
      locked: b.locked,
      completed: b.completed,
      createdAt: b.createdAt,
    })),
  });
});

// POST — create a backup (optional `ignore` globs to exclude caches/dynmap)
const schema = z.object({ name: z.string().min(1).max(80).optional(), ignore: z.array(z.string()).optional() });
export const POST = route(async (req: Request, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  requireApiScope(principal, "backup.create");
  assertScope(c, "backup.create");
  assertNotSuspended(c);
  const { name, ignore } = schema.parse(await req.json().catch(() => ({})));

  await enforceBackupRetention(c.server.id, c.node);
  const count = await db.backup.count({ where: { serverId: c.server.id } });
  const row = await db.backup.create({
    data: { serverId: c.server.id, name: name ?? `Backup #${count + 1}`, completed: false },
  });
  try {
    const meta = await new DaemonClient(c.node).createBackup(c.server.id, row.id, row.name, ignore);
    await db.backup.update({
      where: { id: row.id },
      data: { completed: true, sizeBytes: BigInt(meta.sizeBytes), checksum: meta.checksum },
    });
    await audit("backup.create", { userId: principal.user.id, serverId: c.server.id, metadata: { backupId: row.id, via: principal.via } });
    return json({ id: row.id, name: row.name, sizeBytes: meta.sizeBytes, completed: true }, 201);
  } catch (e) {
    await db.backup.delete({ where: { id: row.id } }).catch(() => {});
    throw e;
  }
});
