import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, route } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireAdmin();
  const alerts = await db.alert.findMany({
    orderBy: [{ resolved: "asc" }, { updatedAt: "desc" }],
    take: 50,
    include: { server: { select: { name: true } }, node: { select: { name: true } } },
  });
  return json({
    alerts: alerts.map((a) => ({
      id: a.id,
      level: a.level,
      message: a.message,
      resolved: a.resolved,
      target: a.server?.name ?? a.node?.name ?? null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
  });
});
