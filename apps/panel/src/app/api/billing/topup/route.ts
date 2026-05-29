import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { recordTransaction } from "@/lib/billing";
import { audit } from "@/lib/audit";

const schema = z.object({ amount: z.number().int().min(1).max(100000).optional() });

/**
 * DEMO top-up. In production, replace this with a payment-provider checkout
 * (e.g. Stripe) and only credit the wallet on a verified webhook.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const { amount } = schema.parse(await req.json().catch(() => ({})));
  const credits = amount ?? 500;
  const balance = await recordTransaction(user.id, credits, "Top-up (demo)");
  await audit("billing.topup", { userId: user.id, metadata: { credits } });
  return json({ balance, added: credits });
});
