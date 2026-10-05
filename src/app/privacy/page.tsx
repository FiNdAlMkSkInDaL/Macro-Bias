import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy — Macro Bias',
  description: 'What Macro Bias stores for an account, a free alert, and a subscription.',
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
        Macro Bias
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Privacy</h1>
      <div className="mt-8 space-y-4 text-base leading-7 text-zinc-300">
        <p>
          An account stores the email and password with the sign-in service. A free alert stores the email address
          you submit and whether you asked for stocks, crypto, or both.
        </p>
        <p>
          Payment is handled by Stripe. Macro Bias keeps the customer and subscription ids Stripe returns. Card
          numbers stay with Stripe.
        </p>
        <p>
          We keep anonymous page totals and campaign labels to understand which marketing works. Full query
          strings, password reset links, payment details, and private account pages are excluded from this tracking.
        </p>
        <p>
          If you accept optional analytics, a random visitor id and a session id connect your visits with confirmed
          signups and subscriptions. We remember your first discovery and latest marketing source for up to 90 days,
          using a cookie and local browser storage. Sessions restart after 30 minutes without activity. This is not
          fingerprinting and does not store your IP address in our marketing analytics.
        </p>
        <p>
          Choose Essential only to keep page totals anonymous. You can change this choice using Analytics preferences
          on this page. We remember your preference for one year and honor Do Not Track and Global Privacy Control.
        </p>
        <p>
          Marketing email includes an unsubscribe link. Unsubscribing stops the free alerts for that address.
        </p>
      </div>
    </main>
  );
}
