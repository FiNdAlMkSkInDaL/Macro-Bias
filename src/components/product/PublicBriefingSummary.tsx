import { publicMoney, publicPercent, type PublicBriefingSummary as Summary } from '@/lib/product/public-briefing-summary';
import type { ProductAsset } from '@/lib/product/score-access';
import { HeroSignupForm } from './HeroSignupForm';
import styles from './PaidBriefing.module.css';

export function PublicBriefingSummary({ asset, date, summary }: { asset: ProductAsset; date: string; summary: Summary | null }) {
  if (!summary) return null;
  const stocks = asset === 'stocks';
  return <section className={styles.publicSummary} aria-labelledby="public-summary-title" data-public-briefing-summary={asset}>
    <p className={styles.summaryLabel}>Free market summary · completed session <time dateTime={summary.marketDataDate}>{summary.marketDataDate}</time> · {stocks ? 'New York close' : 'UTC close'}</p>
    <h2 id="public-summary-title">{summary.headline}</h2>
    <p>{summary.observation}</p>
    <dl className={styles.summaryQuotes}>{summary.quotes.map(q => <div key={q.ticker}><dt>{q.name}{stocks ? ` (${q.ticker})` : ''}</dt><dd>{publicMoney(q.close)} <span>{publicPercent(q.change)}</span></dd></div>)}</dl>
    <h3>What that tells us</h3><p>{summary.context}</p>
    <h3>What to compare next</h3><p>{summary.watch}</p>
    <div className={styles.summarySignup}>
      <h3>Get the next {stocks ? 'stock' : 'crypto'} update, free</h3>
      <p>The daily score and a short market update by email. Choose either newsletter or both.</p>
      <HeroSignupForm location={stocks ? 'stock_briefing_summary' : 'crypto_briefing_summary'}
        pagePath={`${stocks ? '/briefings' : '/crypto/briefings'}/${date}`} defaultMarket={asset} />
    </div>
  </section>;
}
