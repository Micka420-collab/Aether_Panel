import { z } from "zod";
import { db } from "@/lib/db";
import { route, json } from "@/lib/http";
import { authApi } from "@/lib/api-auth";
import { getServerContext } from "@/lib/access";
import { HttpError } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";

const schema = z.object({ maxUses: z.number().int().positive().optional(), expiresInHours: z.number().int().positive().max(8760).optional() });

/** Owner mints a no-login, start-ONLY shareable wake link. */
export const POST = route(async (req, ctx: { params: { id: string } }) => {
  const principal = await authApi(req);
  const c = await getServerContext(principal.user, ctx.params.id);
  if (!c.isOwner) throw new HttpError(403, "Only the owner can create wake links");
  const body = schema.parse(await req.json().catch(() => ({})));

  const token = randomToken(18);
  await db.wakeLink.create({
    data: {
      serverId: c.server.id,
      token,
      createdById: principal.user.id,
      maxUses: body.maxUses ?? null,
      expiresAt: body.expiresInHours ? new Date(Date.now() + body.expiresInHours * 3600_000) : null,
    },
  });
  await audit("wakelink.create", { userId: principal.user.id, serverId: c.server.id });
  return json({ token, url: `${env.appUrl}/wake/${token}` });
});
