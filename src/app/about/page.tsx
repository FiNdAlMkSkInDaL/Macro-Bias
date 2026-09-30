import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About — Macro Bias',
  description: 'What Macro Bias publishes each session, and what the score is not.',
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
        Macro Bias
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">About</h1>
      <div className="mt-8 space-y-4 text-base leading-7 text-zinc-300">
        <p>
          Macro Bias publishes one daily score before the session, from -100 to +100, for stocks and for crypto.
          The score comes with a permission: LONG, SHORT, FLAT, or NO_TRADE. Reliability is a grade from A to F.
          F means NO_TRADE. A dead zone around zero means FLAT.
        </p>
        <p>
          Free shows the previous session&apos;s score on the site. The paid plan shows today&apos;s score, the grade,
          the size hint, and the morning email. Checkout is a Stripe subscription: $25 a month or $190 a year.
          A failed payment removes paid access.
        </p>
        <p>
          The track record lists settled sessions already stored with the scores. A session that has not settled
          is not on that page.
        </p>
        <p>
          The score is the model output. It is not financial advice, not a price target, not a certainty claim,
          and not a managed fund.
        </p>
      </div>
    </main>
  );
}
