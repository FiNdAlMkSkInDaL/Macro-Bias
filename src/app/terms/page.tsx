import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms — Macro Bias',
  description: 'What Macro Bias sells, what the paid plan includes, and what the score is not.',
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
        Macro Bias
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Terms</h1>
      <div className="mt-8 space-y-4 text-base leading-7 text-zinc-300">
        <p>
          Macro Bias publishes a daily score from -100 to +100 for stocks, and the same kind of score for crypto.
          The score is the model output. It is not financial advice, not a price target, not a certainty claim,
          and not a managed fund.
        </p>
        <p>
          Free alerts email that score. The paid plan shows today&apos;s score, the grade, the size hint, and the
          morning email. Checkout is a Stripe subscription: $25 a month or $190 a year. A failed payment removes
          paid access.
        </p>
        <p>
          The track record lists settled sessions already stored with the scores. A session that has not settled
          is not on that page.
        </p>
      </div>
    </main>
  );
}
