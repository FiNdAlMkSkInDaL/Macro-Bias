import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Stocks and crypto explained: practical market guides',
  description: 'Worked examples for comparing SPY with QQQ and Bitcoin with Ethereum. Learn what the prices show, what they do not, and read free public briefing samples.',
  alternates: { canonical: '/learn' },
};

const guides = [
  { market: 'Stocks', title: 'SPY vs QQQ: when the indexes disagree', path: '/intel/spy-vs-qqq-divergence', description: 'Compare matched returns, understand a moving-average reference, and avoid confusing two ETFs with market breadth.', sample: '/today', archive: '/briefings', cadence: 'Free updates on market days' },
  { market: 'Crypto', title: 'Bitcoin vs Ethereum: relative strength explained', path: '/intel/bitcoin-ethereum-divergence', description: 'Work through ETH/BTC, distinguish losing less from gaining, and compare the same completed UTC session.', sample: '/crypto', archive: '/crypto/briefings', cadence: 'Free updates every day' },
];

export default function LearnPage() {
  return <main className="mx-auto min-h-screen max-w-5xl px-5 py-12 font-[family:var(--font-heading)] text-zinc-100 sm:px-8 sm:py-20">
    <p className="text-sm text-[#c9f58a]">Macro Bias · Stocks &amp; crypto</p>
    <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">Make sense of the move.</h1>
    <p className="mt-6 max-w-2xl text-lg leading-relaxed text-zinc-400">What moved, how the major markets compare, and what to watch next. Start with a worked example, then read an actual public briefing sample. No account needed.</p>
    <div className="mt-10 grid gap-6 md:grid-cols-2">
      {guides.map(g => <section key={g.market} className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950 p-6 sm:p-8" aria-label={`${g.market} guide and sample`}>
        <p className="text-sm text-[#c9f58a]">{g.market}</p>
        <h2 className="mt-4 text-2xl font-medium leading-snug"><Link className="hover:underline" href={g.path}>{g.title}</Link></h2>
        <p className="mt-4 flex-1 leading-relaxed text-zinc-400">{g.description}</p>
        <Link className="mt-6 text-[#c9f58a] underline underline-offset-4" href={g.path}>Read the worked example →</Link>
        <div className="mt-6 border-t border-zinc-800 pt-6">
          <p className="mb-3 text-sm text-zinc-400">{g.cadence}. Optional paid briefings go deeper.</p>
          <Link className="block font-medium underline underline-offset-4" href={g.sample}>See a real {g.market.toLowerCase()} sample</Link>
          <Link className="mt-3 inline-block text-sm text-zinc-400 underline underline-offset-4" href={g.archive}>Browse published summaries</Link>
        </div>
      </section>)}
    </div>
    <p className="mt-10 max-w-3xl leading-relaxed text-zinc-400">These guides explain observations, not a proven forecasting edge. Historical comparisons and daily readings can be wrong. We keep what the data shows separate from what still needs to be tested.</p>
  </main>;
}
