import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, verifyPassword, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { audit } from "@/lib/audit";

const schema = z.object({ password: z.string().min(1) });

export const POST = route(async (req) => {
  const user = await requireUser();
  const { password } = schema.parse(await req.json());
  if (!(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, "Wrong password");
  await db.user.update({
    where: { id: user.id },
    data: { totpEnabled: false, totpSecret: null, recoveryCodes: null },
  });
  await audit("user.2fa.disable", { userId: user.id });
  return json({ ok: true });
});
