"use client";
import Link from "next/link";
import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/util";

export interface PlanView {
  slug: string;
  name: string;
  priceMonthly: number;
  priceAnnual: number;
  popular: boolean;
  features: string[];
}

export function Pricing({ plans }: { plans: PlanView[] }) {
  const [annual, setAnnual] = useState(false);
  return (
    <div>
      <div className="mb-10 flex items-center justify-center gap-3">
        <span className={cn("text-sm", !annual ? "text-white" : "text-white/50")}>Monthly</span>
        <button
          onClick={() => setAnnual((v) => !v)}
          className="relative h-7 w-14 rounded-full border border-white/15 bg-white/5 transition"
          aria-label="Toggle annual billing"
        >
          <span
            className={cn(
              "absolute top-1 h-5 w-5 rounded-full bg-cyan-violet transition-all",
              annual ? "left-8" : "left-1",
            )}
          />
        </button>
        <span className={cn("text-sm", annual ? "text-white" : "text-white/50")}>
          Annual <span className="ml-1 rounded-full bg-online/15 px-2 py-0.5 text-xs text-online">Save 20%</span>
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((p) => {
          const price = annual ? p.priceAnnual / 12 : p.priceMonthly;
          return (
            <div
              key={p.slug}
              className={cn(
                "relative flex flex-col rounded-3xl border p-7 transition",
                p.popular
                  ? "border-cyan/50 bg-white/[0.07] shadow-glow md:-translate-y-3 md:scale-[1.03]"
                  : "border-white/10 bg-white/[0.04]",
              )}
            >
              {p.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-cyan-violet px-3 py-1 text-xs font-semibold text-white">
                  Most popular
                </span>
              )}
              <h3 className="font-display text-xl font-semibold text-white">{p.name}</h3>
              <div className="mt-4 flex items-end gap-1">
                <span className="font-display text-4xl font-bold text-white">${(price / 100).toFixed(2)}</span>
                <span className="mb-1 text-sm text-white/50">/mo</span>
              </div>
              {annual && <p className="mt-1 text-xs text-white/40">billed ${(p.priceAnnual / 100).toFixed(2)} / year</p>}
              <ul className="mt-6 flex-1 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-white/75">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={`/register?plan=${p.slug}`}
                className={cn("mt-7", p.popular ? "btn-primary" : "btn-ghost")}
              >
                Choose {p.name}
              </Link>
            </div>
          );
        })}
      </div>
      <p className="mt-8 text-center text-sm text-white/40">
        Every plan includes a <span className="text-white/70">72-hour money-back guarantee</span>, DDoS protection and
        wake-on-join sleeping.
      </p>
    </div>
  );
}
