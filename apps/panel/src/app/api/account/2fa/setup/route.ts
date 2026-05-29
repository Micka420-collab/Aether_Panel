import QRCode from "qrcode";
import { db } from "@/lib/db";
import { requireUser, newTotpSecret, totpUri, encryptSecret } from "@/lib/auth";
import { json, route } from "@/lib/http";

export const POST = route(async () => {
  const user = await requireUser();
  const secret = newTotpSecret();
  await db.user.update({ where: { id: user.id }, data: { totpSecret: encryptSecret(secret) } });
  const uri = totpUri(user.username, secret);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
  return json({ secret, uri, qr });
});
