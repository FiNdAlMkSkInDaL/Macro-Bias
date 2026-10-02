import styles from '@/components/product/MemberUI.module.css';
import { formatScore, formatSignedPercent, formatTradeDate } from '@/lib/public-proof/format';
import type { SettledSession } from '@/lib/track-record/settled-sessions';

export function SettledSessionsSection({ asset, market, rows, loadError = null }: {
  asset: string;
  market: string;
  rows: SettledSession[];
  loadError?: string | null;
}) {
  return (
      <section className={styles.section} aria-labelledby="settled-results">
        <h2 id="settled-results">Settled sessions</h2>
        <p>Results from the latest 80 published scores. A row appears once the next session has a stored open and close.</p>
        {loadError ? <p className={styles.notice} role="status">{loadError}</p> : rows.length === 0 ? <p className={styles.notice}>No settled next-session results have been stored yet.</p> : (
          <>
            <p>{rows.length} settled session{rows.length === 1 ? '' : 's'}.</p>
            <div className={styles.tableWrap} style={{ maxHeight: '34rem' }} tabIndex={0} role="region" aria-label={`${asset} settled sessions`}>
              <table className={`${styles.table} ${styles.historyTable}`} style={{ minWidth: '580px' }}>
                <caption className="sr-only">Published score dates and their next-session {market} open-to-close returns.</caption>
                <thead><tr><th scope="col">Score date</th><th scope="col">Session</th><th scope="col">Score</th><th scope="col">Open to close</th></tr></thead>
                <tbody>{rows.map(row => <tr key={`${row.scoreDate}-${row.sessionDate}`}><td>{formatTradeDate(row.scoreDate)}</td><td>{formatTradeDate(row.sessionDate)}</td><td>{formatScore(row.score)}</td><td>{formatSignedPercent(row.openToClosePct)}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
        <p>Not financial advice.</p>
      </section>
  );
}
