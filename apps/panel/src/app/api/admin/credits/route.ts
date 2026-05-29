import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, HttpError } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { recordTransaction } from "@/lib/billing";
import { audit } from "@/lib/audit";

const schema = z.object({
  email: z.string().email(),
  amount: z.number().int(),
  reason: z.string().max(120).optional(),
});

/** Admin: grant (or remove) credits from a user's wallet. */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const { email, amount, reason } = schema.parse(await req.json());
  const target = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!target) throw new HttpError(404, "No user with that email");
  const balance = await recordTransaction(target.id, amount, reason || `Admin grant by ${admin.username}`);
  await audit("admin.credits", { userId: admin.id, metadata: { target: target.username, amount } });
  return json({ balance });
});
