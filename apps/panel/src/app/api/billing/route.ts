import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { hourlyCost, RATE_PER_GB_HOUR } from "@/lib/billing";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireUser();
  const servers = await db.server.findMany({
    where: { ownerId: user.id },
    select: { id: true, name: true, memoryMb: true, state: true },
  });
  const dailyBurn = servers
    .filter((s) => s.state === "running")
    .reduce((acc, s) => acc + hourlyCost(s.memoryMb) * 24, 0);

  const transactions = await db.transaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return json({
    balance: user.credits,
    ratePerGbHour: RATE_PER_GB_HOUR,
    dailyBurn,
    servers: servers.map((s) => ({ id: s.id, name: s.name, state: s.state, hourlyCost: hourlyCost(s.memoryMb) })),
    transactions: transactions.map((t) => ({ id: t.id, amount: t.amount, balance: t.balance, reason: t.reason, createdAt: t.createdAt })),
  });
});
