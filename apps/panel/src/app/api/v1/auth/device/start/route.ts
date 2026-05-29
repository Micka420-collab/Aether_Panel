import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { randomToken, userCode } from "@/lib/crypto";
import { env } from "@/lib/env";

const EXPIRES_SECONDS = 600;

/**
 * Begin the device-code flow. A desktop launcher calls this, shows the
 * user_code + verification_uri, then polls /poll until the user approves it
 * in the panel (or it expires).
 */
export const POST = route(async () => {
  const deviceCode = randomToken(32);
  const code = userCode();
  await db.deviceAuth.create({
    data: {
      deviceCode,
      userCode: code,
      interval: 5,
      expiresAt: new Date(Date.now() + EXPIRES_SECONDS * 1000),
    },
  });
  return json({
    device_code: deviceCode,
    user_code: code,
    verification_uri: `${env.appUrl}/link`,
    verification_uri_complete: `${env.appUrl}/link?code=${encodeURIComponent(code)}`,
    interval: 5,
    expires_in: EXPIRES_SECONDS,
  });
});
