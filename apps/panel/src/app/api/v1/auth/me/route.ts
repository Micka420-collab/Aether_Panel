import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { authApi } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const principal = await authApi(req);
  const user = principal.user;
  const serversCount = await db.server.count({
    where: { OR: [{ ownerId: user.id }, { subusers: { some: { userId: user.id } } }] },
  });
  const mc = await db.oAuthAccount.findFirst({ where: { userId: user.id, provider: "microsoft" } });
  // Email/role are PII — only expose them to a full-access ("*") key, not to a
  // narrow automation token.
  const full = principal.scopes.includes("*");
  return json({
    id: user.id,
    name: user.username,
    servers_count: serversCount,
    minecraft: mc ? { uuid: mc.mcUuid, name: mc.mcUsername } : null,
    ...(full ? { email: user.email, role: user.role } : {}),
  });
});
