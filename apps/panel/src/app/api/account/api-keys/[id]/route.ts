import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { noContent, route } from "@/lib/http";
import { audit } from "@/lib/audit";

export const DELETE = route(async (_req, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const key = await db.apiKey.findUnique({ where: { id: ctx.params.id } });
  if (!key || key.userId !== user.id) throw new HttpError(404, "Key not found");
  await db.apiKey.delete({ where: { id: key.id } });
  await audit("apikey.revoke", { userId: user.id, metadata: { prefix: key.prefix } });
  return noContent();
});
