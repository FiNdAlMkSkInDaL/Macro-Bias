import type { ProductAsset } from '@/lib/product/score-access';
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

export function ProReading({ asset, tradeDate, score, label }: {
  asset: ProductAsset; tradeDate: string | null; score: number | null; label: string | null;
}) {
  const market = asset === 'stocks' ? 'stock' : 'crypto';
  const storedLabel = labelText(label);
  const tone = label?.includes('RISK_ON') ? 'positive' : label?.includes('RISK_OFF') ? 'negative' : 'neutral';
  const hasScore = finite(score);
  return (
    <section className={styles.reading} data-pro-current-reading data-tone={tone} aria-label={`Current ${market} reading`}>
      <header className={styles.readingHeader}>
        <h2>Daily {market} score</h2>
        <time dateTime={tradeDate ?? undefined}>{dateLabel(tradeDate)}</time>
      </header>
      {hasScore ? <div className={styles.readingBody}>
        <div className={styles.value}><p>{score > 0 ? '+' : ''}{score}</p><span>{storedLabel}</span></div>
        <div className={styles.scale} aria-label={`Published score ${score} on a scale from minus 100 to plus 100`}>
          <div className={styles.rail}><span style={{ left: `${(Math.max(-100, Math.min(100, score)) + 100) / 2}%` }} /></div>
          <div className={styles.scaleLabels}><span>−100</span><span>0</span><span>+100</span></div>
        </div>
      </div> : <p className={styles.missing}>The published reading is unavailable.</p>}
    </section>
  );
}
