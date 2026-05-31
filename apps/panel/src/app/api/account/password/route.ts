import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, getAuth, verifyPassword, hashPassword, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { sha256 } from "@/lib/crypto";
import { lockedFor, recordFailure, resetFailures, MFA_POLICY } from "@/lib/lockout";
import { audit } from "@/lib/audit";

const schema = z.object({
  currentPassword: z
    .string()
    .min(1)
    .refine((s) => s.trim().length > 0, "Password cannot be empty"),
  // Same policy as registration (apps/.../auth/register).
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(200),
});

/**
 * Change the signed-in user's password.
 *
 * Security:
 *  - requires the CURRENT password (defeats a hijacked-session silent takeover),
 *  - per-user lockout on wrong current-password (same MFA_POLICY as TOTP/recovery
 *    checks) so a stolen session can't brute-force it,
 *  - rejects reusing the same password,
 *  - re-hashes with bcrypt (same cost as registration),
 *  - revokes every OTHER session (so a stolen/old cookie elsewhere is killed),
 *    while keeping THIS session alive so the user isn't logged out of the tab
 *    they're using.
 *
 * Note on CSRF: this is a same-origin JSON POST. A cross-site HTML form can't set
 * Content-Type: application/json, and the SameSite=Lax session cookie isn't sent
 * on cross-site POSTs — so the panel's cookie+JSON model already blocks CSRF here
 * (consistent with every other mutating route).
 */
export const POST = route(async (req) => {
  // requireUser() enforces auth + 2FA-when-enabled (getCurrentUser returns null
  // for a 2FA-pending session); getAuth() gives us the current session token so
  // we can spare it from the mass revoke below.
  const user = await requireUser();
  const auth = await getAuth();
  if (!auth) throw new HttpError(401, "Authentication required"); // also narrows `auth` for TS

  const lockKey = `password-change:${user.id}`;
  const wait = lockedFor(lockKey);
  if (wait) throw new HttpError(429, `Too many attempts. Try again in ${wait}s.`);

  const { currentPassword, newPassword } = schema.parse(await req.json());

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    recordFailure(lockKey, MFA_POLICY);
    throw new HttpError(401, "Current password is incorrect");
  }
  resetFailures(lockKey);

  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new HttpError(400, "New password must be different from the current one");
  }

  const passwordHash = await hashPassword(newPassword);
  await db.user.update({ where: { id: user.id }, data: { passwordHash } });

  // Invalidate all other sessions; keep the current one.
  const revoked = await db.session.deleteMany({
    where: { userId: user.id, tokenHash: { not: sha256(auth.sessionToken) } },
  });

  await audit("user.password.change", { userId: user.id, metadata: { revokedSessions: revoked.count } });
  return json({ ok: true });
});
