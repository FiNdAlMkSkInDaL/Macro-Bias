import Link from 'next/link';

import type { ProductAsset } from '@/lib/product/score-access';
import { formatBiasLabel, formatScore, formatTradeDate } from '@/lib/public-proof/format';
import type { PublishedReading } from '@/lib/track-record/published-reading-links';
import type { PublishedReadingsData } from '@/lib/track-record/published-readings';
import { ArrowIcon } from './ArrowIcon';
import shared from './MemberUI.module.css';
import styles from './PublishedReadings.module.css';

function BriefingAvailability({ row, now }: { row: PublishedReading; now: number }) {
  if (row.briefingStatus === 'unavailable') return <span className={styles.availability}>Availability unavailable</span>;
  if (row.briefingStatus === 'missing') return <span className={styles.availability}>No full briefing published</span>;

  const release = row.freeAvailableAt ? Date.parse(row.freeAvailableAt) : NaN;
  const free = Number.isFinite(release) && now >= release;
  return (
    <span className={styles.availability}>
      <span className={styles.open}>Full briefing<ArrowIcon /></span>
      {free ? <small>Free for signed-in members</small> : <small>Pro access{Number.isFinite(release) ? <> · free for members from {new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(release)} UTC</> : null}</small>}
    </span>
  );
}

export function PublishedReadings({ asset, data }: { asset: ProductAsset; data: PublishedReadingsData }) {
  const market = asset === 'stocks' ? 'stock' : 'crypto';
  const now = Date.now();
  return (
    <section className={shared.section} aria-labelledby="published-readings">
      <h2 id="published-readings">Published readings</h2>
      {data.loadError ? <p className={shared.notice} role="status">{data.loadError}</p> : data.rows.length ? (
        <>
          <p>{data.rows.length} published reading{data.rows.length === 1 ? '' : 's'}. Select a linked reading to open its full dated briefing.</p>
          {data.briefingNotice ? <p className={shared.notice} role="status">{data.briefingNotice}</p> : null}
          <div className={styles.history} tabIndex={0} role="region" aria-label={`Latest 80 published ${market} readings`}>
            <div className={styles.columns} aria-hidden="true"><span>Reading date</span><span>Score</span><span>Regime</span><span>Full briefing</span></div>
            <ul className={styles.list}>
              {data.rows.map((row) => {
                const cells = <><time dateTime={row.tradeDate}>{formatTradeDate(row.tradeDate)}</time><span className={row.score > 0 ? shared.positive : row.score < 0 ? shared.negative : undefined}><span className="sr-only">Score </span>{formatScore(row.score)}</span><span>{formatBiasLabel(row.biasLabel)}</span><BriefingAvailability row={row} now={now} /></>;
                return <li key={row.tradeDate}>{row.briefingHref ? <Link className={styles.row} href={row.briefingHref}>{cells}</Link> : <div className={`${styles.row} ${styles.unlinked}`}>{cells}</div>}</li>;
              })}
            </ul>
          </div>
        </>
      ) : <p className={shared.notice}>No {market} reading has been published yet.</p>}
    </section>
  );
}
