"use client";

import { useState } from "react";
import Link from "next/link";

type BillingCycle = "monthly" | "annual";

const features = [
  { name: "Daily macro regime score", free: true, pro: true },
  { name: "Top-line market summary", free: true, pro: true },
  { name: "Regime classification (5 states)", free: true, pro: true },
  { name: "Daily email briefing", free: "Preview", pro: true },
  { name: "Full sector breakdown", free: false, pro: true },
  { name: "Historical pattern analysis", free: false, pro: true },
  { name: "Cluster averages & confidence", free: false, pro: true },
  { name: "Cross-asset regime heatmap", free: false, pro: true },
  { name: "Intraday playbook & positioning", free: false, pro: true },
  { name: "Risk check & model notes", free: false, pro: true },
  { name: "Weekly regime recap digest", free: false, pro: true },
  { name: "Daily crypto regime score & briefing", free: "Preview", pro: true },
  { name: "Full crypto market breakdown", free: false, pro: true },
] as const;

function renderFeatureValue(value: boolean | string) {
  if (value === true) {
    return (
      <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }

  if (typeof value === "string") {
    return (
      <span className="font-[family:var(--font-data)] text-[10px] uppercase tracking-widest text-zinc-500">
        {value}
      </span>
    );
  }

  return (
    <span className="text-zinc-700">—</span>
  );
}

export default function PricingPage() {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  const monthlyPrice = 25;
  const annualPrice = 190;
  const annualMonthly = Math.round((annualPrice / 12) * 100) / 100;
  const annualSavings = monthlyPrice * 12 - annualPrice;

  const displayPrice = cycle === "monthly" ? monthlyPrice : annualMonthly;
  const billingLabel = cycle === "monthly" ? "/month" : "/mo, billed annually";
  const checkoutHref = `/api/checkout?plan=${cycle}`;

  return (
    <main
      className="min-h-screen font-[family:var(--font-heading)]"
    >
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        {/* Header */}
        <header className="text-center">
          <h1 className="font-[family:var(--font-heading)] text-4xl font-bold tracking-tighter text-white sm:text-5xl">
            Simple pricing. No surprises.
          </h1>
          <p className="mt-4 text-lg leading-8 text-zinc-400">
            Start with a 7-day free trial. Cancel anytime.
          </p>

          {/* Billing toggle */}
          <div className="mt-8 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] p-1">
            <button
              type="button"
              onClick={() => setCycle("monthly")}
              className={`rounded-full px-5 py-2 text-sm font-medium transition ${
                cycle === "monthly"
                  ? "bg-white text-black"
                  : "text-zinc-400 hover:text-white"
              }`}
              data-analytics-event="pricing_cycle_selected"
              data-analytics-label="Monthly"
              data-analytics-location="pricing_toggle"
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setCycle("annual")}
              className={`rounded-full px-5 py-2 text-sm font-medium transition ${
                cycle === "annual"
                  ? "bg-white text-black"
                  : "text-zinc-400 hover:text-white"
              }`}
              data-analytics-event="pricing_cycle_selected"
              data-analytics-label="Annual"
              data-analytics-location="pricing_toggle"
            >
              Annual
              <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 font-[family:var(--font-data)] text-[10px] font-bold text-emerald-400">
                Save ${annualSavings}
              </span>
            </button>
          </div>
        </header>

        {/* Pricing cards */}
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {/* Free tier */}
          <div className="flex flex-col border border-white/10 bg-zinc-950 p-8">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Free Tier ]
            </p>
            <h2 className="mt-4 font-[family:var(--font-heading)] text-3xl font-bold tracking-tight text-white">
              Free
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Daily regime score via email
            </p>
            <p className="mt-6">
              <span className="font-[family:var(--font-data)] text-4xl font-bold text-white">
                $0
              </span>
              <span className="ml-1 text-sm text-zinc-500">/forever</span>
            </p>
            <Link
              href="/emails"
              className="mt-6 inline-flex items-center justify-center border border-white/20 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
              data-analytics-event="pricing_cta_click"
              data-analytics-label="Subscribe Free"
              data-analytics-location="pricing_free_card"
            >
              Subscribe Free
            </Link>
            <ul className="mt-8 flex-1 space-y-3 border-t border-white/10 pt-6">
              {features.map((f) =>
                f.free ? (
                  <li key={f.name} className="flex items-center gap-3 text-sm text-zinc-300">
                    <span className="flex h-4 w-4 items-center justify-center">
                      {renderFeatureValue(f.free)}
                    </span>
                    {f.name}
                  </li>
                ) : (
                  <li key={f.name} className="flex items-center gap-3 text-sm text-zinc-600">
                    <span className="flex h-4 w-4 items-center justify-center">
                      {renderFeatureValue(f.free)}
                    </span>
                    {f.name}
                  </li>
                ),
              )}
            </ul>
          </div>

          {/* Pro tier */}
          <div className="relative flex flex-col border border-sky-500/40 bg-gradient-to-b from-sky-500/[0.06] to-zinc-950 p-8">
            <div className="absolute -top-3 right-6 rounded-full bg-sky-500 px-3 py-1 font-[family:var(--font-data)] text-[10px] font-bold uppercase tracking-widest text-white">
              7-Day Free Trial
            </div>
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-sky-300">
              [ Pro ]
            </p>
            <h2 className="mt-4 font-[family:var(--font-heading)] text-3xl font-bold tracking-tight text-white">
              Premium
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Full briefing + historical playbook
            </p>
            <p className="mt-6">
              <span className="font-[family:var(--font-data)] text-4xl font-bold text-white">
                ${displayPrice.toFixed(displayPrice % 1 === 0 ? 0 : 2)}
              </span>
              <span className="ml-1 text-sm text-zinc-500">{billingLabel}</span>
            </p>
            {cycle === "annual" && (
              <p className="mt-1 font-[family:var(--font-data)] text-xs text-emerald-400">
                ${annualPrice}/year — save ${annualSavings} vs monthly
              </p>
            )}
            <a
              href={checkoutHref}
              className="mt-6 inline-flex items-center justify-center rounded-xl border border-sky-400/50 bg-gradient-to-r from-sky-500 to-sky-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-sky-500/20 transition hover:from-sky-400 hover:to-sky-500"
              data-analytics-event="pricing_cta_click"
              data-analytics-label="Start 7-Day Free Trial"
              data-analytics-location="pricing_pro_card"
            >
              Start 7-Day Free Trial
            </a>
            <p className="mt-2 text-center text-xs text-zinc-600">
              No charge for 7 days. Cancel anytime.
            </p>
            <ul className="mt-8 flex-1 space-y-3 border-t border-sky-500/20 pt-6">
              {features.map((f) => (
                <li key={f.name} className="flex items-center gap-3 text-sm text-zinc-300">
                  <span className="flex h-4 w-4 items-center justify-center">
                    {renderFeatureValue(f.pro)}
                  </span>
                  {f.name}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* FAQ */}
        <section className="mt-16 border border-white/10 bg-zinc-950 px-6 py-10 sm:px-10">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Pricing FAQ ]
          </p>
          <div className="mt-6 divide-y divide-white/5">
            <div className="py-5 first:pt-0">
              <h3 className="text-sm font-semibold text-white">
                What happens during the 7-day trial?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                You get full Premium access instantly — the complete daily
                briefing, historical pattern analysis, sector breakdown, and risk check.
                Your card is not charged until day 8. Cancel in one click from
                your account settings.
              </p>
            </div>
            <div className="py-5">
              <h3 className="text-sm font-semibold text-white">
                Can I cancel anytime?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                Yes. Manage or cancel your subscription from the dashboard at any
                time. If you cancel during the trial, you&apos;re never charged.
                After the trial, cancellation takes effect at the end of your
                current billing period.
              </p>
            </div>
            <div className="py-5">
              <h3 className="text-sm font-semibold text-white">
                What do free subscribers get?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                Free subscribers receive a daily email with the regime score and
                top-line alpha protocol — the one-sentence directional call — every
                trading day. No account required, no credit card, no expiration.
              </p>
            </div>
            <div className="py-5">
              <h3 className="text-sm font-semibold text-white">
                What&apos;s the difference between monthly and annual?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                Both plans include identical Premium features. The annual plan
                is ${annualPrice}/year (${annualMonthly.toFixed(2)}/mo) — saving
                you ${annualSavings} compared to paying monthly.
              </p>
            </div>
            <div className="py-5 last:pb-0">
              <h3 className="text-sm font-semibold text-white">
                Is the data delivered before market open?
              </h3>
              <p className="mt-2 text-sm leading-7 text-zinc-400">
                Yes. The algo runs on the previous session&apos;s close data and
                the briefing is published before the US equity open every trading
                day. Premium subscribers receive the full briefing via email and
                in the dashboard.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
