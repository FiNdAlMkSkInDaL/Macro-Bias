import 'server-only';

import Link from 'next/link';
import type { ReactNode } from 'react';

import type { ProductAsset } from '@/lib/product/score-access';
import type { WorkspaceData, WorkspaceMarketTape } from '@/lib/product/workspace-data';
import type { TradableSignal } from '@/lib/signal/types';
import { MacroMarketChart } from './MacroMarketChart';
import { MarketTabs } from './MemberShell';
import { ProReading } from './ProReading';
import type { ProContextObservation } from './pro-context-observations';
import styles from './ProWorkspace.module.css';

export type ProPillar = {
  key: string;
  label: string;
  source: string;
  description: string;
  contribution: number | null;
  weight: number | null;
  signal: number | null;
  summary: string | null;
};

export type ProAssetQuote = {
  ticker: string;
  currentPrice: number | null;
  dailyChangePercent: number | null;
  tradeDate: string | null;
  dateSource: 'ticker' | 'snapshot' | 'supplemental' | null;
};

export type ProStockComparisons = {
  kind: 'stocks';
  alignedSessionCount: number;
  candidateCount: number;
  featureTickers: string[];
  clusterAveragePlaybook: {
    intradayNet: number | null;
    overnightGap: number | null;
    sessionRange: number | null;
  };
  matches: {
    intradayNet: number | null;
    matchConfidence: number;
    nextSessionDate: string;
    overnightGap: number | null;
    sessionRange: number | null;
    tradeDate: string;
  }[];
};

export type ProCryptoComparisons = {
  kind: 'crypto';
  matches: {
    distance: number;
    btcForward1DayReturn: number;
    btcForward3DayReturn: number;
    tradeDate: string;
    weight?: number;
  }[];
  matchCount: number;
  avg1d: number | null;
  avg3d: number | null;
  bearish1d: number | null;
  bearish3d: number | null;
};

export type ProDiagnostics = {
  modelVersion: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  blendedForwardReturn: number | null;
  scoringMatchCount: number | null;
  settings: { label: string; value: string; description?: string }[];
};

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const priceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function dateLabel(value: string | null | undefined) {
  if (!value) return 'Not available';
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : 'Not available';
}

function percentage(value: number | null | undefined, signed = true) {
  return finite(value) ? `${signed && value > 0 ? '+' : ''}${value.toFixed(2)}%` : 'Not available';
}

function tone(value: number | null | undefined) {
  return finite(value) && value > 0 ? styles.positive : finite(value) && value < 0 ? styles.negative : styles.neutral;
}

function price(value: number | null, ticker: string) {
  if (!finite(value) || value <= 0) return 'Not available';
  return ticker === 'VIX' ? value.toFixed(2) : priceFormatter.format(value);
}

function matchDateSpan(matches: { tradeDate: string }[]) {
  const dates = matches.map((match) => match.tradeDate).sort();
  if (!dates.length) return null;
  return `Displayed match dates: ${dateLabel(dates[0])} – ${dateLabel(dates.at(-1))}.`;
}

function cryptoMatchScore(distance: number) {
  return finite(distance) ? `${Math.round(Math.max(0, Math.min(100, 100 * Math.exp(-distance * 0.5))))}%` : 'Not available';
}

function Metric({ label, value, className, children }: { label: string; value: ReactNode; className?: string; children?: ReactNode }) {
  return <div><dt>{label}</dt><dd className={className}>{value}{children ? <small>{children}</small> : null}</dd></div>;
}

function ModelContext({ observations }: { observations: ProContextObservation[] }) {
  return (
    <div className={styles.contextPanel} data-pro-pillars>
      <h3>Model context</h3>
      <p className={styles.contextNote}>Recorded inputs for this published session.</p>
      {observations.length ? observations.slice(0, 3).map((observation) => (
        <article className={styles.pillar} key={observation.key} data-pro-context={observation.key}>
          <div className={styles.pillarName}><h4>{observation.label}</h4></div>
          <div className={styles.pillarDescription}>
            <p>{observation.text}</p>
          </div>
        </article>
      )) : <p className={styles.contextNote}>Recorded model context is unavailable for this session.</p>}
    </div>
  );
}

export function ProMarketPrices({ assets, tape, loading = false }: { assets: ProAssetQuote[]; tape: WorkspaceMarketTape; loading?: boolean }) {
  const basket = tape.entries.map((entry) => entry.ticker.replace('-USD', '')).join(' · ');
  const supplementalQuotes = assets
    .filter((asset) => asset.dateSource === 'supplemental' && finite(asset.currentPrice) && asset.currentPrice > 0)
    .map((asset) => asset.ticker)
    .length > 0;
  return (
    <div className={styles.marketPanel} data-pro-market-prices>
      <h3>Across the market</h3>
      <p className={styles.contextNote} data-pro-core-basket>Basket moves · {basket || 'Recorded prices unavailable'}</p>
      <dl className={styles.participation} aria-label="Tracked basket moves">
        <Metric label="Strongest" value={tape.strongest?.ticker ?? 'Not available'}><span className={tone(tape.strongest?.percentChange)}>{percentage(tape.strongest?.percentChange)}</span></Metric>
        <Metric label="Weakest" value={tape.weakest?.ticker ?? 'Not available'}><span className={tone(tape.weakest?.percentChange)}>{percentage(tape.weakest?.percentChange)}</span></Metric>
        <Metric label="Advancing" value={tape.breadth.total ? `${tape.breadth.advancers}/${tape.breadth.total}` : 'Not available'}>in the tracked basket</Metric>
      </dl>
      <div className={styles.marketTableWrap} tabIndex={0} role="region" aria-label="Market prices and source dates, scroll horizontally if needed">
        <table className={`${styles.table} ${styles.marketTable}`}>
          <caption className={styles.srOnly}>Saved snapshot quotes and latest available supplemental daily quotes</caption>
          <thead><tr><th scope="col">Market</th><th scope="col">Price</th><th scope="col">Day move</th><th scope="col" className={styles.quoteDate}>Price date</th></tr></thead>
          <tbody>{assets.map((asset) => {
            const hasPrice = finite(asset.currentPrice) && asset.currentPrice > 0;
            const move = hasPrice ? asset.dailyChangePercent : null;
            return (
            <tr key={asset.ticker} data-pro-asset={asset.ticker} data-pro-quote-source={asset.dateSource ?? undefined}>
              <th scope="row">{asset.ticker.replace('-USD', '')}</th>
              <td>{price(asset.currentPrice, asset.ticker)}{hasPrice && asset.tradeDate ? <time className={styles.mobilePriceDate} dateTime={asset.tradeDate}>{asset.tradeDate}</time> : null}</td>
              <td className={tone(move)}>{percentage(move)}</td>
              <td className={styles.quoteDate}>{hasPrice && asset.tradeDate ? <time dateTime={asset.tradeDate}>{asset.tradeDate}</time> : 'Not available'}{hasPrice && asset.dateSource === 'snapshot' ? <span className={styles.dateSource}>snapshot date</span> : null}</td>
            </tr>
            );
          })}</tbody>
        </table>
      </div>
      <p className={styles.quoteNote}>{loading ? 'Additional market prices are loading. ' : ''}{supplementalQuotes ? 'Additional quotes are shown at their own price dates and excluded from the basket summaries.' : 'Prices are shown at their recorded dates.'}</p>
      {tape.notice ? <p className={styles.quoteNote}>{tape.notice}</p> : null}
    </div>
  );
}

function HistoricalComparisons({ historical }: { historical: ProStockComparisons | ProCryptoComparisons | null }) {
  if (!historical) return <p className={styles.empty}>Historical comparisons are not available for this published session.</p>;
  if (historical.kind === 'stocks') {
    return (
      <>
        <dl className={styles.summaryMetrics}>
          <Metric label="Displayed matches" value={`${historical.matches.length} sessions`} />
          <Metric label="Average overnight gap" value={percentage(historical.clusterAveragePlaybook.overnightGap)} className={tone(historical.clusterAveragePlaybook.overnightGap)} />
          <Metric label="Average open-to-close" value={percentage(historical.clusterAveragePlaybook.intradayNet)} className={tone(historical.clusterAveragePlaybook.intradayNet)} />
          <Metric label="Average session range" value={percentage(historical.clusterAveragePlaybook.sessionRange, false)} />
        </dl>
        <p className={styles.sampleNote}>{matchDateSpan(historical.matches)} These are SPY moves in the session after each match; they describe historical outcomes rather than a forecast.</p>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Stock historical comparisons, scroll horizontally if needed">
          <table className={`${styles.table} ${styles.historyTable}`}>
            <caption className={styles.srOnly}>SPY outcomes in the session following each historical match</caption>
            <thead><tr><th scope="col">Similar session</th><th scope="col">Similarity</th><th scope="col">Overnight gap</th><th scope="col">Open-to-close</th><th scope="col">Session range</th></tr></thead>
            <tbody>{historical.matches.map((match) => (
              <tr key={match.tradeDate}>
                <th scope="row"><time dateTime={match.tradeDate}>{dateLabel(match.tradeDate)}</time><span className={styles.followingDate}>Following <time dateTime={match.nextSessionDate}>{dateLabel(match.nextSessionDate)}</time></span></th>
                <td>{finite(match.matchConfidence) ? `${match.matchConfidence}%` : 'Not available'}</td>
                <td className={tone(match.overnightGap)}>{percentage(match.overnightGap)}</td>
                <td className={tone(match.intradayNet)}>{percentage(match.intradayNet)}</td>
                <td>{percentage(match.sessionRange, false)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className={styles.sampleNote}>The averages describe these displayed matches, which may differ from the set used for the score. Similarity measures how closely the historical conditions match. Overnight gap compares the next open with the previous close; open-to-close and range describe that following session.</p>
      </>
    );
  }
  return (
    <>
      <dl className={styles.summaryMetrics}>
        <Metric label="Historical matches" value={`${historical.matchCount} sessions`} />
        <Metric label="Average after 1 day" value={percentage(historical.avg1d)} className={tone(historical.avg1d)} />
        <Metric label="Average after 3 days" value={percentage(historical.avg3d)} className={tone(historical.avg3d)} />
        <Metric label="Matches with a BTC decline" value={<>{finite(historical.bearish1d) ? `${Math.round(historical.bearish1d * 100)}%` : 'Not available'}<span className={styles.metricSecondary}>next 1 session</span></>}><span>{finite(historical.bearish3d) ? `${Math.round(historical.bearish3d * 100)}%` : 'Not available'} over the next 3 sessions</span></Metric>
      </dl>
      <p className={styles.sampleNote}>{matchDateSpan(historical.matches)}</p>
      <p className={styles.sampleNote}>BTC moves are measured from one daily close to the next, including weekends. The averages give closer matches more weight; the decline percentages count each match equally.</p>
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Crypto historical comparisons, scroll horizontally if needed">
        <table className={`${styles.table} ${styles.historyTable}`}>
          <caption className={styles.srOnly}>Following BTC close-to-close returns for each historical match</caption>
          <thead><tr><th scope="col">Similar session</th><th scope="col">Similarity</th><th scope="col">BTC after 1 day</th><th scope="col">BTC after 3 days</th></tr></thead>
          <tbody>{historical.matches.map((match) => (
            <tr key={match.tradeDate}>
              <th scope="row"><time dateTime={match.tradeDate}>{dateLabel(match.tradeDate)}</time></th>
              <td>{cryptoMatchScore(match.distance)}</td>
              <td className={tone(match.btcForward1DayReturn)}>{percentage(match.btcForward1DayReturn)}</td>
              <td className={tone(match.btcForward3DayReturn)}>{percentage(match.btcForward3DayReturn)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className={styles.sampleNote}>Similarity measures how closely the historical conditions match. These historical outcomes describe the recorded matches rather than a forecast.</p>
    </>
  );
}

export function ProBriefingActions({ asset, briefing }: {
  asset: ProductAsset;
  briefing: { href: string | null; notice: string | null };
}) {
  const archivePath = asset === 'stocks' ? '/briefings' : '/crypto/briefings';
  return (
    <div className={styles.briefingActions} data-pro-briefing-actions>
      <Link className={styles.primaryButton} href={briefing.href ?? archivePath} data-pro-briefing-link>{briefing.href ? 'Read full briefing' : 'Briefing archive'}</Link>
      {briefing.href ? <Link className={styles.secondaryButton} href={archivePath}>Briefing archive</Link> : null}
    </div>
  );
}

export function ProWorkspace({ asset, published, chart, observations = [], assets, participation, historical, marketPrices, notice, actions, briefing }: {
  asset: ProductAsset;
  published: { tradeDate: string; score: number; label: string } | null;
  signal?: TradableSignal | null;
  chart: WorkspaceData['active'];
  pillars?: ProPillar[];
  observations?: ProContextObservation[];
  assets: ProAssetQuote[];
  participation: WorkspaceMarketTape;
  historical: ProStockComparisons | ProCryptoComparisons | null;
  diagnostics?: ProDiagnostics;
  marketPrices?: ReactNode;
  notice?: string | null;
  actions?: ReactNode;
  briefing: { href: string | null; notice: string | null };
}) {
  const stocks = asset === 'stocks';
  const tradeDate = published?.tradeDate ?? null;
  return (
    <div className={styles.workspace} data-pro-workspace={asset}>
      <div className={styles.toolbar}>
        <MarketTabs asset={asset} view="dashboard" />
      </div>
      {briefing.notice ? <p className={styles.briefingNotice}>{briefing.notice}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      <div className={styles.readingGrid} data-pro-reading-grid>
        <ProReading asset={asset} tradeDate={tradeDate} score={published?.score ?? null} label={published?.label ?? null} />
      </div>
      <div className={styles.chart}>
        <MacroMarketChart
          variant="history" instrument={stocks ? 'SPY' : 'BTC'} title={`${stocks ? 'SPY' : 'BTC'} price & daily bias`}
          candles={chart.candles} marks={chart.history}
          latest={chart.score ? { tradeDate: chart.score.tradeDate, score: chart.score.score, biasLabel: chart.score.label } : null}
          notice={chart.historyNotice ?? chart.priceNotice ?? chart.loadError}
        />
        <p className={styles.chartNote}>Explore past sessions; the daily score and briefing stay on the published session.</p>
      </div>
      <section className={styles.evidence} aria-labelledby={`${asset}-evidence-heading`}>
        <header className={styles.sectionHeading}><h2 id={`${asset}-evidence-heading`}>Behind the daily score</h2></header>
        <div className={styles.evidenceGrid}><ModelContext observations={observations} />{marketPrices ?? <ProMarketPrices assets={assets} tape={participation} />}</div>
      </section>
      <section className={styles.history} aria-labelledby={`${asset}-historical-heading`} data-pro-historical>
        <header className={styles.sectionHeading}><h2 id={`${asset}-historical-heading`}>What similar sessions did</h2><p>Historical comparisons for the published reading.</p></header>
        <HistoricalComparisons historical={historical} />
      </section>
      {actions ? <div className={styles.utility}>{actions}</div> : null}
    </div>
  );
}
