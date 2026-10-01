import type { ProductAsset } from '@/lib/product/score-access';
import type { TradableSignal } from '@/lib/signal/types';
import styles from './ProReading.module.css';

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

function dateLabel(date: string | null) {
  if (!date) return 'Session date unavailable';
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? dateFormatter.format(parsed) : 'Session date unavailable';
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function labelText(label: string | null) {
  return label ? label.toLowerCase().split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Regime unavailable';
}

function fractionPercent(value: unknown) {
  return finite(value) && value >= 0 && value <= 1 ? `${Math.round(value * 100)}%` : 'Not available';
}

function DisclosureArrow() {
  return <svg className={styles.disclosureArrow} viewBox="0 0 20 20" aria-hidden="true" fill="none"><path d="m7 4 6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function plainDecision(signal: TradableSignal | null) {
  if (!signal) return 'No model decision is stored for this published session.';
  const reason = typeof signal.reason === 'string' ? signal.reason.toLowerCase() : '';
  if (signal.position === 'NO_TRADE') {
    if (reason.includes('cluster is too loose')) return 'The historical matches are too dissimilar for a directional call.';
    if (reason.includes('disagreement is high')) return 'The historical matches disagree too much for a directional call.';
    if (reason.includes('no historical analogs')) return 'There are no historical matches available for a directional call.';
    return 'The model is withholding a directional reading for this session.';
  }
  if (signal.position === 'FLAT') {
    if (reason.includes('monday dampener')) return 'The model uses its reduced-risk Monday setting and stays in cash.';
    if (reason.includes('neutral dead zone')) return 'The score is within the model’s neutral range. The model stays in cash.';
    if (reason.includes('fights the trend/vol')) return 'The historical lean conflicts with the trend and volatility checks. The model stays in cash.';
    return 'The model stays in cash for this published session.';
  }
  if (signal.position === 'LONG') return 'The model permits a long bias for this published session.';
  if (signal.position === 'SHORT') return 'The model permits a short bias for this published session.';
  return 'The saved model permission is not available.';
}

export function ProReading({ asset, tradeDate, score, label }: {
  asset: ProductAsset; tradeDate: string | null; score: number | null; label: string | null;
}) {
  const market = asset === 'stocks' ? 'stock' : 'crypto';
  const storedLabel = labelText(label);
  const tone = label?.includes('RISK_ON') ? 'positive' : label?.includes('RISK_OFF') ? 'negative' : 'neutral';
  const hasScore = finite(score);
  return (
    <section className={styles.reading} data-pro-current-reading data-tone={tone} aria-label={`Current ${market} reading`}>
      <h2>Current {market} reading</h2>
      <time dateTime={tradeDate ?? undefined}>{dateLabel(tradeDate)}</time>
      {hasScore ? <>
        <div className={styles.value}><p>{score > 0 ? '+' : ''}{score}</p><span>{storedLabel}</span></div>
        <div className={styles.scale} aria-label={`Published score ${score} on a scale from minus 100 to plus 100`}>
          <div className={styles.rail}><span style={{ left: `${(Math.max(-100, Math.min(100, score)) + 100) / 2}%` }} /></div>
          <div className={styles.scaleLabels}><span>−100</span><span>0</span><span>+100</span></div>
        </div>
        <p className={styles.description}>The published {market} regime is <strong>{storedLabel}</strong>.</p>
      </> : <p className={styles.missing}>The published reading is unavailable.</p>}
    </section>
  );
}

export function ProDecision({ asset, tradeDate, signal }: {
  asset: ProductAsset; tradeDate: string | null; signal: TradableSignal | null;
}) {
  const permission = signal && ['LONG', 'SHORT', 'FLAT', 'NO_TRADE'].includes(signal.position) ? signal.position : 'Not available';
  const grade = signal && ['A', 'B', 'C', 'D', 'F'].includes(signal.reliability) ? signal.reliability : 'Not available';
  return (
    <section className={styles.decision} data-pro-model-decision data-session-date={tradeDate ?? undefined}>
      <h2>Model decision</h2>
      <time dateTime={tradeDate ?? undefined}>{dateLabel(tradeDate)}</time>
      <dl className={styles.metrics}>
        <div><dt>Permission</dt><dd>{permission}</dd></div>
        <div><dt>Suggested size</dt><dd>{fractionPercent(signal?.size)}</dd></div>
        <div><dt>Reliability</dt><dd>{grade}</dd></div>
        <div><dt>Historical agreement</dt><dd>{fractionPercent(signal?.neighborAgreement)}</dd></div>
      </dl>
      <p className={styles.reason}>{plainDecision(signal)}</p>
      <details className={styles.disclosure}>
        <summary>How to read this decision<DisclosureArrow /></summary>
        <dl className={styles.definitions}>
          <div><dt>Permission</dt><dd>The saved model position: LONG or SHORT permits that bias; FLAT stays in cash; NO_TRADE withholds a directional call. Permission can differ from the headline regime.</dd></div>
          <div><dt>Suggested size</dt><dd>A fraction of a full model unit, based on score magnitude, historical agreement and match closeness. It is not a percentage of your portfolio. FLAT and NO_TRADE use zero size.</dd></div>
          <div><dt>Reliability</dt><dd>A grade based on agreement and match closeness, with model rejection checks. A is the strongest grade; F rejects a directional call. It is not an accuracy percentage.</dd></div>
          <div><dt>Historical agreement</dt><dd>The share of historical blended forward returns aligned with the score’s sign. At a score of zero, it counts absolute moves below 0.15%. It does not measure agreement with a cash position or the chance of a winning trade.</dd></div>
        </dl>
      </details>
      <details className={styles.disclosure}>
        <summary>Model details<DisclosureArrow /></summary>
        <p className={styles.savedNote}>{typeof signal?.reason === 'string' && signal.reason.trim() ? signal.reason : 'No saved model note is available for this session.'}</p>
        {signal ? <dl className={styles.diagnostics}>
          <div><dt>Market</dt><dd>{asset === 'stocks' ? 'Stocks' : 'Crypto'}</dd></div>
          <div><dt>Published session</dt><dd>{dateLabel(tradeDate)}</dd></div>
          <div><dt>Mean match distance</dt><dd>{finite(signal.meanNeighborDistance) ? signal.meanNeighborDistance.toFixed(4) : 'Not available'}</dd></div>
          <div><dt>Match closeness</dt><dd>{finite(signal.distanceQuality) ? signal.distanceQuality.toFixed(4) : 'Not available'}</dd></div>
          <div><dt>Directional call withheld</dt><dd>{signal.noTrade ? 'Yes' : 'No'}</dd></div>
        </dl> : null}
      </details>
    </section>
  );
}
