import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, verifyTotp, decryptSecret, getAuth, markSessionMfaComplete, HttpError } from "@/lib/auth";
import { hmac, randomString } from "@/lib/crypto";
import { json, route } from "@/lib/http";
import { audit } from "@/lib/audit";

const schema = z.object({ code: z.string().min(6).max(20) });

export const POST = route(async (req) => {
  const user = await requireUser();
  const { code } = schema.parse(await req.json());
  if (!user.totpSecret) throw new HttpError(400, "Start 2FA setup first");
  if (!verifyTotp(code.replace(/\s/g, ""), decryptSecret(user.totpSecret)))
    throw new HttpError(401, "Invalid code");

  // Generate 10 single-use recovery codes (~58 bits each). Store only a keyed
  // HMAC so a DB dump can't be brute-forced without also stealing AUTH_SECRET.
  const plain = Array.from({ length: 10 }, () => `${randomString(5)}-${randomString(5)}`);
  const hashed = plain.map((c) => hmac(c.replace(/-/g, "")));
  await db.user.update({
    where: { id: user.id },
    data: { totpEnabled: true, recoveryCodes: JSON.stringify(hashed) },
  });

  const auth = await getAuth();
  if (auth) await markSessionMfaComplete(auth.sessionToken);
  await audit("user.2fa.enable", { userId: user.id });
  return json({ ok: true, recoveryCodes: plain });
});
