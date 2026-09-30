import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { loadAlertPreferences } from '@/lib/account/alert-preferences';
import { getStripeCustomerId } from '@/lib/billing/stripe-customer';
import { getUserSubscriptionStatus, isSubscriptionActive } from '@/lib/billing/subscription';

import { AlertForm } from './alert-form';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Account — Macro Bias',
  description: 'Account, billing, and email alerts.',
};

export default async function AccountPage() {
  const { subscriptionStatus, user } = await getUserSubscriptionStatus();

  if (!user?.email) {
    redirect('/login?redirectTo=/account');
  }

  const [stripeCustomerId, alerts] = await Promise.all([
    getStripeCustomerId(user.id),
    loadAlertPreferences(user.email),
  ]);
  const paid = isSubscriptionActive(subscriptionStatus);
  const billingHref = stripeCustomerId ? '/api/stripe/portal' : '/pricing';
  const billingLabel = stripeCustomerId ? 'Manage billing' : 'See plans';

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
        Account
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Account</h1>
      <p className="mt-3 text-sm leading-6 text-zinc-400">{user.email}</p>
      <p className="mt-4 text-sm text-zinc-300">
        <Link href="/dashboard" className="underline underline-offset-4 hover:text-white">
          Dashboard
        </Link>
        <span className="px-2 text-zinc-600">/</span>
        <Link href="/crypto/dashboard" className="underline underline-offset-4 hover:text-white">
          Crypto dashboard
        </Link>
      </p>

      <section className="mt-10 border border-white/10 p-5">
        <h2 className="text-lg font-semibold text-white">Billing</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          {paid ? 'Paid plan.' : 'Free plan.'}{' '}
          {stripeCustomerId
            ? 'Manage billing opens the Stripe portal for this account.'
            : 'Plans stay on the pricing page. Checkout starts there.'}
        </p>
        <a
          href={billingHref}
          className="mt-4 inline-flex h-12 w-full items-center justify-center bg-white px-5 text-sm font-semibold text-black sm:w-auto"
        >
          {billingLabel}
        </a>
      </section>

      <section className="mt-6 border border-white/10 p-5">
        <h2 className="text-lg font-semibold text-white">Email alerts</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Morning email for this account. Stocks, crypto, or both. Saving does not send a message.
        </p>
        <AlertForm cryptoOptedIn={alerts.cryptoOptedIn} stocksOptedIn={alerts.stocksOptedIn} />
      </section>
    </main>
  );
}
