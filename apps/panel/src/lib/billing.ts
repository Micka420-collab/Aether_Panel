import "server-only";
import { db } from "./db";
import { DaemonClient } from "./daemon";

/** Credits charged per GB of RAM per hour while a server is running. */
export const RATE_PER_GB_HOUR = 1;

export function hourlyCost(memoryMb: number): number {
  return Math.max(1, Math.ceil((memoryMb / 1024) * RATE_PER_GB_HOUR));
}

/** Record a ledger entry and return the new balance. */
export async function recordTransaction(
  userId: string,
  amount: number,
  reason: string,
  serverId?: string,
): Promise<number> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const balance = Math.max(0, user.credits + amount);
    await tx.user.update({ where: { id: userId }, data: { credits: balance } });
    await tx.transaction.create({ data: { userId, serverId: serverId ?? null, amount, balance, reason } });
    return balance;
  });
}

/**
 * Meter running servers against their owner's credit wallet. Called once per
 * scheduler tick; only bills in whole-hour increments to keep the ledger sparse.
 * When an owner runs out of credits, the server is stopped and suspended.
 */
export async function meterBilling(): Promise<void> {
  const now = Date.now();
  const servers = await db.server.findMany({
    where: { state: "running", suspended: false },
    include: { node: true },
  });

  for (const s of servers) {
    if (!s.lastBilledAt) {
      await db.server.update({ where: { id: s.id }, data: { lastBilledAt: new Date(now) } });
      continue;
    }
    const fullHours = Math.floor((now - s.lastBilledAt.getTime()) / 3_600_000);
    if (fullHours < 1) continue;

    const cost = fullHours * hourlyCost(s.memoryMb);
    const owner = await db.user.findUnique({ where: { id: s.ownerId } });
    if (!owner) continue;

    const billedUntil = new Date(s.lastBilledAt.getTime() + fullHours * 3_600_000);

    if (owner.credits < cost) {
      // Out of credits — bill what's left, stop & suspend the server.
      await recordTransaction(owner.id, -owner.credits, `Out of credits — ${s.name} stopped`, s.id);
      await db.server.update({ where: { id: s.id }, data: { suspended: true, state: "suspended", lastBilledAt: null } });
      try {
        await new DaemonClient(s.node).power(s.id, "stop");
      } catch {
        /* node offline */
      }
      continue;
    }

    await recordTransaction(owner.id, -cost, `${s.name} · ${fullHours}h @ ${hourlyCost(s.memoryMb)}cr/h`, s.id);
    await db.server.update({ where: { id: s.id }, data: { lastBilledAt: billedUntil } });
  }
}
