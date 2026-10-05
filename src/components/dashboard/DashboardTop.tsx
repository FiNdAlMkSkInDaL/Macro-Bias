import type { DashboardTapeAsset } from './StormFrontsCard';
import styles from './DashboardTop.module.css';

export type { DashboardTapeAsset };

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

function formatBias(label: string) {
  return label.toLowerCase().split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function formatMove(value: number | null) {
  return value == null ? 'Not available' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function DashboardTop({ assets, biasLabel, biasScore, hasScore, note, tradeDate, marketName = 'Stocks' }: {
  assets: (DashboardTapeAsset & { tradeDate?: string; dateSource?: 'ticker' | 'snapshot' })[];
  biasLabel?: string | null;
  biasScore: number;
  hasScore: boolean;
  note?: string | null;
  tradeDate?: string | null;
  marketName?: 'Stocks' | 'Crypto';
}) {
  const tone = biasLabel?.includes('RISK_OFF') ? 'negative' : biasLabel?.includes('RISK_ON') ? 'positive' : 'neutral';
  const label = biasLabel ? formatBias(biasLabel) : 'Not available';
  const sortedAssets = [...assets].sort((a, b) => a.dailyChangePercent - b.dailyChangePercent);
  const strongest = sortedAssets.at(-1);
  const weakest = sortedAssets[0];
  const advancers = assets.filter((asset) => asset.dailyChangePercent > 0).length;
  const participationCopy = assets.length
    ? `${biasLabel ? `The published regime is ${label}. ` : ''}Market moves below come from the saved snapshot.`
    : 'Market participation is not available for this published session.';

  return (
    <div className={styles.top}>
      <section className={styles.panel} aria-label={`${marketName} published reading`}>
        <div className={styles.readingHeading}><h2>{marketName} reading</h2>{tradeDate ? <time dateTime={tradeDate}>{dateFormatter.format(new Date(`${tradeDate}T00:00:00Z`))}</time> : <span>Session not available</span>}</div>
        {hasScore ? (
          <>
            <div className={styles.scoreLine}><p>{biasScore > 0 ? '+' : ''}{biasScore}</p><span>{label}</span></div>
            <div className={styles.scale} aria-label={`Macro Bias ${biasScore} on a scale from minus 100 to plus 100`}>
              <div className={styles.rail}><i /><i /><i /><span data-tone={tone} style={{ left: `${(Math.max(-100, Math.min(100, biasScore)) + 100) / 2}%` }} /></div>
              <div className={styles.scaleLabels}><span>−100</span><span>0</span><span>+100</span></div>
            </div>
          </>
        ) : <p className={styles.missing}>No score is stored for this session.</p>}
      </section>
      <section className={styles.panel} aria-labelledby="dashboard-participation-heading">
        <h2 id="dashboard-participation-heading">Market participation</h2>
        <p className={styles.description}>{hasScore ? participationCopy : note ?? 'Market context will appear when a score session is available.'}</p>
        <dl className={styles.participation}>
          <div><dt>Strongest</dt><dd>{strongest?.ticker ?? '—'}<span>{formatMove(strongest?.dailyChangePercent ?? null)}</span>{strongest?.tradeDate ? <time dateTime={strongest.tradeDate}>{dateFormatter.format(new Date(`${strongest.tradeDate}T00:00:00Z`))}{strongest.dateSource === 'snapshot' ? ' · snapshot' : ''}</time> : null}</dd></div>
          <div><dt>Weakest</dt><dd>{weakest?.ticker ?? '—'}<span>{formatMove(weakest?.dailyChangePercent ?? null)}</span>{weakest?.tradeDate ? <time dateTime={weakest.tradeDate}>{dateFormatter.format(new Date(`${weakest.tradeDate}T00:00:00Z`))}{weakest.dateSource === 'snapshot' ? ' · snapshot' : ''}</time> : null}</dd></div>
          <div><dt>Breadth</dt><dd>{assets.length ? `${advancers}/${assets.length}` : '—'}<span>{assets.length ? 'advancing' : 'Not available'}</span></dd></div>
        </dl>
      </section>
    </div>
  );
}
