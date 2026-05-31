import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordTransaction } from "@/lib/billing";
import {
  constructWebhookEvent,
  stripeConfigured,
  stripeWebhookConfigured,
  eurToCredits,
} from "@/lib/stripe";
import { audit } from "@/lib/audit";

// Webhook signature verification needs the *raw* request body and the Node
// crypto APIs Stripe's SDK uses, so this route must run on the Node runtime and
// never be statically optimized.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook receiver. Verifies the signature against STRIPE_WEBHOOK_SECRET
 * and, on `checkout.session.completed`, credits the user's wallet exactly once.
 *
 * Idempotency: Stripe retries deliveries, so before crediting we check whether a
 * Transaction already references this checkout session id (encoded in the
 * reason string) and skip if so. This avoids double-crediting on retries.
 */
export async function POST(req: Request): Promise<Response> {
  // Dormant when unconfigured: ack with 503 so Stripe shows the endpoint as
  // unhealthy rather than us throwing/leaking — and we never touch the wallet.
  if (!stripeConfigured() || !stripeWebhookConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  // Read the raw body exactly as sent — JSON.parse would break HMAC verification.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (e) {
    console.error("[stripe-webhook] signature verification failed", e);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, event.id);
    }
  } catch (e) {
    // Return 500 so Stripe retries — but log the detail server-side only.
    console.error("[stripe-webhook] handler error", e);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  // Always 200 for events we don't act on, so Stripe stops retrying them.
  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, eventId: string): Promise<void> {
  // Only act on fully paid sessions for our own top-up flow.
  if (session.payment_status !== "paid") return;
  if (session.metadata?.kind !== "wallet_topup") return;

  const userId = session.metadata?.userId;
  if (!userId) {
    console.error("[stripe-webhook] checkout.session.completed without userId", session.id);
    return;
  }

  // Trust the amount actually charged (in cents → euros) over client metadata.
  const amountTotal = session.amount_total ?? 0;
  const credits =
    amountTotal > 0 ? eurToCredits(amountTotal / 100) : Number(session.metadata?.credits ?? 0);
  if (!Number.isFinite(credits) || credits <= 0) return;

  // Ensure the user still exists (account could have been deleted mid-flow).
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    console.error("[stripe-webhook] user not found for session", session.id, userId);
    return;
  }

  // Idempotency guard: the checkout session id is embedded in every top-up
  // reason, so a retried delivery is a no-op.
  const reason = `Card top-up · ${session.id}`;
  const existing = await db.transaction.findFirst({ where: { userId, reason } });
  if (existing) return;

  const balance = await recordTransaction(userId, credits, reason);

  await audit("billing.topup.stripe", {
    userId,
    metadata: { credits, balance, sessionId: session.id, eventId },
  });
}
