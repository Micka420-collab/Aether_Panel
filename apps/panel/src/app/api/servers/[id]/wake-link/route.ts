import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { getServerContext } from "@/lib/access";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";

/** Session-authenticated wake-link creation for the dashboard Network tab. */
export const POST = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const c = await getServerContext(user, ctx.params.id);
  if (!c.isOwner) throw new HttpError(403, "Only the owner can create wake links");
  const token = randomToken(18);
  await db.wakeLink.create({ data: { serverId: c.server.id, token, createdById: user.id } });
  await audit("wakelink.create", { userId: user.id, serverId: c.server.id });
  return json({ token, url: `${env.appUrl}/wake/${token}` });
});
