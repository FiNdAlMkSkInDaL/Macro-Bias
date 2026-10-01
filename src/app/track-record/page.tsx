import type { Metadata } from 'next';

import { MarketTabs, MemberShell } from '@/components/product/MemberShell';
import styles from '@/components/product/MemberUI.module.css';
import { formatBiasLabel, formatScore, formatSignedPercent, formatTradeDate, formatUsd, formatWeight } from '@/lib/public-proof/format';
import { loadPaperSnapshot, loadStoredStockScores } from '@/lib/public-proof/load-public-proof';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = {
  title: 'Stock track record — Macro Bias',
  description: 'Published Macro Bias stock readings and the latest stored paper snapshot. Not financial advice.',
};

export default async function TrackRecordPage() {
  const [scores, paper] = await Promise.all([loadStoredStockScores(), loadPaperSnapshot()]);
  return (
    <MemberShell title="Stock track record">
      <MarketTabs asset="stocks" view="history" />
      <p className={styles.muted}>Review published stock readings and the latest stored paper snapshot.</p>
      <section className={styles.section} aria-labelledby="published-readings">
        <h2 id="published-readings">Published readings</h2>
        {scores.error ? (
          <p className={styles.notice} role="status">Published readings are temporarily unavailable. Please try again.</p>
        ) : scores.value && scores.value.length > 0 ? (
          <>
            <p>{scores.value.length} published reading{scores.value.length === 1 ? '' : 's'}.</p>
            <div className={styles.tableWrap} style={{ maxHeight: '34rem' }} tabIndex={0} role="region" aria-label="Published stock readings">
              <table className={`${styles.table} ${styles.stockTable} ${styles.historyTable}`}>
                <caption className="sr-only">The latest 80 published stock readings.</caption>
                <thead><tr><th scope="col">Trade date</th><th scope="col">Score</th><th scope="col">Regime</th></tr></thead>
                <tbody>{scores.value.map(row => <tr key={row.tradeDate}><td>{formatTradeDate(row.tradeDate)}</td><td>{formatScore(row.score)}</td><td>{formatBiasLabel(row.biasLabel)}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        ) : <p className={styles.notice}>No stock reading has been published yet.</p>}
      </section>
      <section className={styles.section} aria-labelledby="paper-comparison">
        <h2 id="paper-comparison">Paper comparison</h2>
        <p>The latest stored paper snapshot, with the SPY mark from the first and latest snapshots in that book.</p>
        {paper.error ? (
          <p className={styles.notice} role="status">The paper comparison is temporarily unavailable. Please try again.</p>
        ) : paper.value ? (
          <dl className={styles.definitionRows}>
            <div><dt>Equity</dt><dd>{formatUsd(paper.value.equity)}</dd></div>
            <div><dt>Total return</dt><dd>{formatSignedPercent(paper.value.totalReturnPct)}</dd></div>
            <div><dt>Sessions tracked</dt><dd>{paper.value.sessionsTracked}</dd></div>
            <div><dt>Cash weight</dt><dd>{formatWeight(paper.value.cashWeight)}</dd></div>
            <div><dt>SPY mark</dt><dd>{paper.value.spyMarkReturnPct != null && paper.value.spyFromDate && paper.value.spyToDate ? <>{formatSignedPercent(paper.value.spyMarkReturnPct)}<small>{formatTradeDate(paper.value.spyFromDate)} to {formatTradeDate(paper.value.spyToDate)}</small></> : <small>The stored marks do not span two prices yet.</small>}</dd></div>
          </dl>
        ) : <p className={styles.notice}>No paper snapshot has been stored yet.</p>}
        <p>Paper results are simulated. Not financial advice.</p>
      </section>
    </MemberShell>
  );
}
