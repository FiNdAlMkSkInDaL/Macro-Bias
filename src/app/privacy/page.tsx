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
          The site records page views and alert signups, including the page, the referrer, and campaign parameters
          when those are present.
        </p>
        <p>
          Marketing email includes an unsubscribe link. Unsubscribing stops the free alerts for that address.
        </p>
      </div>
    </main>
  );
}
