import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext, assertScope } from "@/lib/access";
import { DaemonClient } from "@/lib/daemon";
import { enforceBackupRetention } from "@/lib/backups";
import { audit } from "@/lib/audit";

export const GET = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
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
      storage: b.storage,
      createdAt: b.createdAt,
    })),
  });
});

const schema = z.object({ name: z.string().min(1).max(80).optional() });

export const POST = route(async (req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  assertScope(c, "backup.create");
  const { name } = schema.parse(await req.json().catch(() => ({})));

  // Retention: prune oldest unlocked backups so the archive dir can't fill the disk.
  await enforceBackupRetention(c.server.id, c.node);

  const count = await db.backup.count({ where: { serverId: c.server.id } });
  const row = await db.backup.create({
    data: { serverId: c.server.id, name: name ?? `Backup #${count + 1}`, completed: false },
  });

  try {
    const meta = await new DaemonClient(c.node).createBackup(c.server.id, row.id, row.name);
    await db.backup.update({
      where: { id: row.id },
      data: { completed: true, sizeBytes: BigInt(meta.sizeBytes), checksum: meta.checksum },
    });
    await audit("backup.create", { userId: user.id, serverId: c.server.id, metadata: { backupId: row.id } });
    return json({ id: row.id, name: row.name, sizeBytes: meta.sizeBytes, completed: true }, 201);
  } catch (e: any) {
    await db.backup.delete({ where: { id: row.id } }).catch(() => {});
    throw e;
  }
});
