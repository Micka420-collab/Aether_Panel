import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword, createSession, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { audit } from "@/lib/audit";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = route(async (req) => {
  const { email, password } = schema.parse(await req.json());
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });

  // constant-ish work whether or not the user exists
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) throw new HttpError(401, "Invalid email or password");

  await createSession(user.id, !user.totpEnabled);
  await audit("user.login", { userId: user.id, metadata: { needs2fa: user.totpEnabled } });

  return json({ ok: true, needs2fa: user.totpEnabled, role: user.role });
});
