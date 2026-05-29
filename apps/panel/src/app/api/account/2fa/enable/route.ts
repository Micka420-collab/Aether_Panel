import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, verifyTotp, decryptSecret, getAuth, markSessionMfaComplete, HttpError } from "@/lib/auth";
import { sha256, randomString } from "@/lib/crypto";
import { json, route } from "@/lib/http";
import { audit } from "@/lib/audit";

const schema = z.object({ code: z.string().min(6).max(10) });

export const POST = route(async (req) => {
  const user = await requireUser();
  const { code } = schema.parse(await req.json());
  if (!user.totpSecret) throw new HttpError(400, "Start 2FA setup first");
  if (!verifyTotp(code.replace(/\s/g, ""), decryptSecret(user.totpSecret)))
    throw new HttpError(401, "Invalid code");

  // Generate 10 single-use recovery codes; store only their hashes.
  const plain = Array.from({ length: 10 }, () => `${randomString(4)}-${randomString(4)}`.toUpperCase());
  const hashed = plain.map((c) => sha256(c.replace(/-/g, "")));
  await db.user.update({
    where: { id: user.id },
    data: { totpEnabled: true, recoveryCodes: JSON.stringify(hashed) },
  });

  const auth = await getAuth();
  if (auth) await markSessionMfaComplete(auth.sessionToken);
  await audit("user.2fa.enable", { userId: user.id });
  return json({ ok: true, recoveryCodes: plain });
});
