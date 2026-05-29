import { z } from "zod";
import { db } from "@/lib/db";
import { getAuth, markSessionMfaComplete, verifyTotp, decryptSecret, HttpError } from "@/lib/auth";
import { hmac, constantTimeEqual } from "@/lib/crypto";
import { lockedFor, recordFailure, resetFailures, MFA_POLICY } from "@/lib/lockout";
import { json, route } from "@/lib/http";

const schema = z.object({ code: z.string().min(6).max(20) });

export const POST = route(async (req) => {
  const { code } = schema.parse(await req.json());
  const auth = await getAuth();
  if (!auth) throw new HttpError(401, "No pending session");
  const { user, sessionToken } = auth;
  if (!user.totpEnabled || !user.totpSecret) throw new HttpError(400, "2FA is not enabled");

  const lockKey = `2fa:${user.id}`;
  const wait = lockedFor(lockKey);
  if (wait) throw new HttpError(429, `Too many attempts. Try again in ${wait}s.`);

  const clean = code.replace(/\s|-/g, "");
  let valid = verifyTotp(clean, decryptSecret(user.totpSecret));

  // fall back to single-use recovery codes (keyed HMAC, constant-time scan)
  if (!valid && user.recoveryCodes) {
    const codes = JSON.parse(user.recoveryCodes) as string[];
    const h = hmac(clean);
    const idx = codes.findIndex((stored) => constantTimeEqual(stored, h));
    if (idx >= 0) {
      codes.splice(idx, 1);
      await db.user.update({ where: { id: user.id }, data: { recoveryCodes: JSON.stringify(codes) } });
      valid = true;
    }
  }

  if (!valid) {
    recordFailure(lockKey, MFA_POLICY);
    throw new HttpError(401, "Invalid 2FA code");
  }
  resetFailures(lockKey);
  await markSessionMfaComplete(sessionToken);
  return json({ ok: true });
});
