'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

type BillingCycle = 'monthly' | 'annual';

const paidFeatures = [
  "Today's stock score",
  "Today's crypto score",
  'Permission: LONG / SHORT / FLAT / NO_TRADE',
  'Reliability grade A–F',
  'Size hint',
  'Morning email before the session',
];

const freeFeatures = [
  "Previous session's stock score on the site",
  "Previous session's crypto score on the site",
];

export function PricingCards() {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const coupon = useSearchParams().get('coupon');
  const couponQuery = coupon && /^[A-Za-z0-9_-]+$/.test(coupon) ? `&coupon=${encodeURIComponent(coupon)}` : '';
  const monthlyPrice = 25;
  const annualPrice = 190;
  const annualMonthly = Math.round((annualPrice / 12) * 100) / 100;
  const annualSavings = monthlyPrice * 12 - annualPrice;
  const displayPrice = cycle === 'monthly' ? monthlyPrice : annualMonthly;
  const billingLabel = cycle === 'monthly' ? '/month' : '/mo, billed annually';

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <header className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">Pricing</h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-zinc-400">
          One paid plan, monthly or annual. The morning score, the grade, the size hint, and the email.
          Not financial advice. Not a managed fund.
        </p>
        <div className="mt-8 inline-flex items-center gap-2 border border-white/10 p-1">
          <button
            type="button"
            onClick={() => setCycle('monthly')}
            className={`px-4 py-2 text-sm ${cycle === 'monthly' ? 'bg-white text-black' : 'text-zinc-400'}`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setCycle('annual')}
            className={`px-4 py-2 text-sm ${cycle === 'annual' ? 'bg-white text-black' : 'text-zinc-400'}`}
          >
            Annual
          </button>
        </div>
      </header>
      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <section className="border border-white/10 bg-zinc-950 p-8">
          <h2 className="text-2xl font-semibold text-white">Free</h2>
          <p className="mt-4 font-[family:var(--font-data)] text-4xl text-white">$0</p>
          <ul className="mt-6 space-y-3 text-sm text-zinc-300">
            {freeFeatures.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </section>
        <section className="border border-sky-500/40 bg-zinc-950 p-8">
          <h2 className="text-2xl font-semibold text-white">Paid</h2>
          <p className="mt-4 font-[family:var(--font-data)] text-4xl text-white">
            ${displayPrice.toFixed(displayPrice % 1 === 0 ? 0 : 2)}
            <span className="ml-2 text-sm text-zinc-500">{billingLabel}</span>
          </p>
          {cycle === 'annual' && (
            <p className="mt-2 text-sm text-emerald-400">
              ${annualPrice}/year. ${annualSavings} less than twelve months.
            </p>
          )}
          <a
            href={`/api/checkout?plan=${cycle}${couponQuery}`}
            className="mt-6 inline-flex w-full items-center justify-center bg-white px-6 py-3 text-sm font-semibold text-black"
          >
            Subscribe
          </a>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            Stripe subscription. The card is billed for the monthly or annual price. A failed payment removes access.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-zinc-300">
            {paidFeatures.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
