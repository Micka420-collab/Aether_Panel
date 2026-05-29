import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { audit } from "@/lib/audit";

const schema = z.object({ code: z.string().min(1) });

/** Called by the logged-in panel user from the /link page to approve a launcher. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const { code } = schema.parse(await req.json());
  const record = await db.deviceAuth.findUnique({ where: { userCode: code.trim().toUpperCase() } });
  if (!record || record.expiresAt < new Date()) throw new HttpError(404, "Code not found or expired");
  await db.deviceAuth.update({ where: { id: record.id }, data: { approved: true, userId: user.id } });
  await audit("launcher.approve", { userId: user.id });
  return json({ ok: true });
});
