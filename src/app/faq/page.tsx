import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'FAQ — Macro Bias',
  description: 'Short answers on the daily score, the free and paid plans, and what the score is not.',
};

const QUESTIONS = [
  {
    question: 'What is the score?',
    answer:
      'A daily number from -100 to +100 for stocks, and the same kind of score for crypto. It comes with a permission: LONG, SHORT, FLAT, or NO_TRADE. Reliability is a grade from A to F. F means NO_TRADE. A dead zone around zero means FLAT.',
  },
  {
    question: 'What does a free account see?',
    answer:
      'Public scores and market history are open. Sign in with a Free account to read full stock and crypto briefings after seven calendar days. Pro includes current full briefings, decisions, model evidence, and market workspaces.',
  },
  {
    question: 'What does Pro cost?',
    answer:
      'Pro is $25 a month or $190 a year, with the same access on either plan. Annual billing saves $110 compared with 12 monthly payments. There is no trial. A failed payment removes paid access.',
  },
  {
    question: 'Is this financial advice?',
    answer:
      'No. The score is the model output. It is not financial advice, not a price target, not a certainty claim, and not a managed fund.',
  },
  {
    question: 'What is on the track record?',
    answer:
      'Settled sessions already stored with the scores. A session that has not settled is not on that page.',
  },
  {
    question: 'Where are billing and email alerts?',
    answer:
      'Sign in with email and password. Billing and email alerts for that login are on the account page. Saving an alert preference does not send a message.',
  },
] as const;

export default function FaqPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
        Macro Bias
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">FAQ</h1>
      <div className="mt-8 space-y-8 text-base leading-7 text-zinc-300">
        {QUESTIONS.map(({ question, answer }) => (
          <section key={question}>
            <h2 className="text-xl font-semibold tracking-tight text-white">{question}</h2>
            <p className="mt-2">{answer}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
