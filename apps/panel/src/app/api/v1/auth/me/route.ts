import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { authApi } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { user } = await authApi(req);
  const serversCount = await db.server.count({
    where: { OR: [{ ownerId: user.id }, { subusers: { some: { userId: user.id } } }] },
  });
  const mc = await db.oAuthAccount.findFirst({ where: { userId: user.id, provider: "microsoft" } });
  return json({
    id: user.id,
    name: user.username,
    email: user.email,
    role: user.role,
    servers_count: serversCount,
    minecraft: mc ? { uuid: mc.mcUuid, name: mc.mcUsername } : null,
  });
});
