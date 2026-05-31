import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { noContent, route } from "@/lib/http";
import { audit } from "@/lib/audit";

export const DELETE = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const webhook = await db.webhook.findUnique({ where: { id: ctx.params.id } });
  if (!webhook || webhook.ownerId !== user.id) throw new HttpError(404, "Webhook not found");
  await db.webhook.delete({ where: { id: webhook.id } });
  await audit("webhook.delete", { userId: user.id, serverId: webhook.serverId ?? undefined, metadata: { url: webhook.url } });
  return noContent();
});
