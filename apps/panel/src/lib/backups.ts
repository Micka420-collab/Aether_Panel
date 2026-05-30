import "server-only";
import type { Node } from "@prisma/client";
import { db } from "./db";
import { DaemonClient } from "./daemon";

const DEFAULT_MAX = Number(process.env.MAX_BACKUPS_PER_SERVER ?? 10);

/**
 * Keep at most `max` backups per server by pruning the OLDEST unlocked ones
 * (locked backups are kept on purpose). Call before creating a new backup so the
 * archive directory can't grow without bound and fill the host disk. Best-effort:
 * deletes the node file then the DB row.
 */
export async function enforceBackupRetention(serverId: string, node: Node, max = DEFAULT_MAX): Promise<void> {
  const total = await db.backup.count({ where: { serverId } });
  const over = total - max + 1; // +1 to make room for the backup about to be created
  if (over <= 0) return;
  const prunable = await db.backup.findMany({
    where: { serverId, locked: false },
    orderBy: { createdAt: "asc" },
    take: over,
  });
  for (const b of prunable) {
    await new DaemonClient(node).deleteBackup(serverId, b.id).catch(() => {});
    await db.backup.delete({ where: { id: b.id } }).catch(() => {});
  }
}
