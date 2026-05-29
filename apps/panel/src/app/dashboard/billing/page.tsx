"use client";
import { useEffect, useState } from "react";
import { Wallet, Loader2, Plus, TrendingDown, Coins, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { api } from "@/lib/client";
import { relativeTime } from "@/lib/util";
import { DEFAULT_PLANS } from "@/lib/plans";

interface Billing {
  balance: number;
  ratePerGbHour: number;
  dailyBurn: number;
  servers: { id: string; name: string; state: string; hourlyCost: number }[];
  transactions: { id: string; amount: number; balance: number; reason: string; createdAt: string }[];
}

export default function BillingPage() {
  const [data, setData] = useState<Billing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<Billing>("/api/billing").then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function topup(amount: number) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/billing/topup", { method: "POST", json: { amount } });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Loader2 className="h-6 w-6 animate-spin text-cyan" />;

  const daysLeft = data.dailyBurn > 0 ? Math.floor(data.balance / data.dailyBurn) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-white">Billing & credits</h1>
        <p className="mt-1 text-sm text-white/50">
          Servers burn <span className="text-white/70">{data.ratePerGbHour} credit / GB / hour</span> while running. You&apos;re
          never charged for stopped or errored servers.
        </p>
      </div>

      {error && <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="glass-raised p-5">
          <div className="flex items-center gap-2 text-xs text-white/40"><Coins className="h-4 w-4" /> Balance</div>
          <div className="mt-1 font-display text-3xl font-bold text-white">{data.balance.toLocaleString()}</div>
          <div className="text-xs text-white/35">credits</div>
        </div>
        <div className="glass p-5">
          <div className="flex items-center gap-2 text-xs text-white/40"><TrendingDown className="h-4 w-4" /> Daily burn</div>
          <div className="mt-1 font-display text-3xl font-bold text-white">{data.dailyBurn.toLocaleString()}</div>
          <div className="text-xs text-white/35">credits / day (running)</div>
        </div>
        <div className="glass p-5">
          <div className="flex items-center gap-2 text-xs text-white/40"><Wallet className="h-4 w-4" /> Runway</div>
          <div className="mt-1 font-display text-3xl font-bold text-white">{daysLeft === null ? "∞" : daysLeft}</div>
          <div className="text-xs text-white/35">days at current burn</div>
        </div>
      </div>

      <div className="glass p-5">
        <h2 className="font-display font-semibold text-white">Top up</h2>
        <p className="mt-1 text-sm text-white/45">Demo top-up — wire a payment provider (Stripe) in production.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[500, 1000, 5000].map((a) => (
            <button key={a} onClick={() => topup(a)} disabled={busy} className="btn-ghost">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {a.toLocaleString()} credits
            </button>
          ))}
        </div>
      </div>

      {data.servers.length > 0 && (
        <div className="glass p-5">
          <h2 className="mb-3 font-display font-semibold text-white">Per-server cost</h2>
          <div className="divide-y divide-white/5">
            {data.servers.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-white/80">{s.name}</span>
                <span className="text-white/45">
                  {s.hourlyCost} cr/h · <span className="capitalize">{s.state}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {DEFAULT_PLANS.map((p) => (
          <div key={p.slug} className="glass p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold text-white">{p.name}</h3>
              {p.popular && <span className="rounded-full bg-cyan/15 px-2 py-0.5 text-[10px] text-cyan-light">popular</span>}
            </div>
            <div className="mt-1 text-sm text-white/45">{p.memoryMb / 1024} GB · {p.cpuPercent}% CPU</div>
            <div className="mt-2 font-display text-xl font-bold text-white">${(p.priceMonthly / 100).toFixed(2)}<span className="text-sm font-normal text-white/40">/mo</span></div>
          </div>
        ))}
      </div>

      <div className="glass p-5">
        <h2 className="mb-3 font-display font-semibold text-white">Transactions</h2>
        {data.transactions.length === 0 ? (
          <p className="py-6 text-center text-sm text-white/30">No transactions yet.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {data.transactions.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                <div className="flex items-center gap-2">
                  {t.amount >= 0 ? <ArrowUpRight className="h-4 w-4 text-online" /> : <ArrowDownRight className="h-4 w-4 text-warn" />}
                  <span className="text-white/75">{t.reason}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={t.amount >= 0 ? "text-online" : "text-warn"}>{t.amount >= 0 ? "+" : ""}{t.amount}</span>
                  <span className="w-24 text-right text-white/35">{relativeTime(t.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
