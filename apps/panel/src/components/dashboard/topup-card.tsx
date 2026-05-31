"use client";

import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { api } from "@/lib/client";

/** Credits granted per euro — keep in sync with CREDITS_PER_EUR in lib/stripe.ts. */
const CREDITS_PER_EUR = 100;
const PRESETS_EUR = [5, 10, 25, 50] as const;

/**
 * "Top up with card" card. Creates a Stripe Checkout Session via
 * POST /api/billing/checkout and redirects the browser to Stripe's hosted page.
 *
 * Safe when payments are unconfigured: the API returns a 503 "Payments are not
 * configured" error which we surface inline; no card UI ever leaks secrets.
 */
export function TopupCard() {
  const [amount, setAmount] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        json: { amountEur: amount },
      });
      // Hand off to Stripe's hosted checkout.
      window.location.href = url;
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
    // On success we navigate away, so no need to clear busy.
  }

  const credits = Math.round(amount * CREDITS_PER_EUR);

  return (
    <div className="glass p-5">
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-cyan" />
        <h2 className="font-display font-semibold text-white">Top up with card</h2>
      </div>
      <p className="mt-1 text-sm text-white/45">
        Pay securely with Stripe. €1 = {CREDITS_PER_EUR} credits. You&apos;ll get{" "}
        <span className="text-white/70">{credits.toLocaleString()}</span> credits.
      </p>

      {error && (
        <div className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {PRESETS_EUR.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAmount(a)}
            disabled={busy}
            className={
              "rounded-xl border px-3 py-1.5 text-sm transition " +
              (amount === a
                ? "border-cyan/50 bg-cyan/15 text-cyan-light"
                : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]")
            }
          >
            €{a}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40">€</span>
          <input
            type="number"
            min={5}
            max={500}
            step={1}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
            disabled={busy}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-2 pl-7 pr-3 text-sm text-white outline-none focus:border-cyan/40"
          />
        </div>
        <button
          type="button"
          onClick={checkout}
          disabled={busy || amount < 5 || amount > 500}
          className="btn-primary"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Pay €{amount || 0}
        </button>
      </div>
      <p className="mt-2 text-xs text-white/30">Min €5 · Max €500 per payment.</p>
    </div>
  );
}

export default TopupCard;
