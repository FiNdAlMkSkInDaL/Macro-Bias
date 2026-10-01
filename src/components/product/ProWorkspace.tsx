import 'server-only';

import Link from 'next/link';
import type { ReactNode } from 'react';

import type { ProductAsset } from '@/lib/product/score-access';
import type { WorkspaceData, WorkspaceMarketTape } from '@/lib/product/workspace-data';
import type { TradableSignal } from '@/lib/signal/types';
import { MacroMarketChart } from './MacroMarketChart';
import { MarketTabs } from './MemberShell';
import { ProDecision, ProReading } from './ProReading';
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
const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

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

function count(value: number | null | undefined) {
  return finite(value) ? numberFormatter.format(value) : 'Not available';
}

function matchDateSpan(matches: { tradeDate: string }[]) {
  const dates = matches.map((match) => match.tradeDate).sort();
  if (!dates.length) return null;
  return `Displayed match dates: ${dateLabel(dates[0])} – ${dateLabel(dates.at(-1))}.`;
}

function disposition(value: number | null) {
  if (!finite(value)) return 'Not available';
  return value > 0.15 ? 'Bullish' : value < -0.15 ? 'Bearish' : 'Neutral';
}

function cryptoMatchScore(distance: number) {
  return finite(distance) ? `${Math.round(Math.max(0, Math.min(100, 100 * Math.exp(-distance * 0.5))))}%` : 'Not available';
}

function Metric({ label, value, className, children }: { label: string; value: ReactNode; className?: string; children?: ReactNode }) {
  return <div><dt>{label}</dt><dd className={className}>{value}{children ? <small>{children}</small> : null}</dd></div>;
}

function ModelContext({ pillars }: { pillars: ProPillar[] }) {
  return (
    <div className={styles.contextPanel} data-pro-pillars>
      <h3>Model context</h3>
      <p className={styles.contextNote}>Saved diagnostic allocations of the published score.</p>
      <div className={styles.pillarHeading} aria-hidden="true"><span>Context</span><span>Contribution</span><span>Details</span></div>
      {pillars.map((pillar) => (
        <article className={styles.pillar} key={pillar.key} data-pro-pillar={pillar.key}>
          <div className={styles.pillarName}><h4>{pillar.label}</h4><p>{pillar.source}</p></div>
          <p className={`${styles.contribution} ${tone(pillar.contribution)}`}>{finite(pillar.contribution) ? `${pillar.contribution > 0 ? '+' : ''}${pillar.contribution.toFixed(1)} pts` : 'Not available'}</p>
          <div className={styles.pillarDescription}>
            <p>{pillar.description}</p>
            <details className={styles.technical}>
              <summary>Technical detail</summary>
              <dl className={styles.technicalValues}>
                <div><dt>Saved weight</dt><dd>{finite(pillar.weight) ? `${pillar.weight.toFixed(0)} pts` : 'Not available'}</dd></div>
                <div><dt>Saved signal</dt><dd>{finite(pillar.signal) ? pillar.signal.toFixed(4) : 'Not available'}</dd></div>
                <div><dt>Signal disposition</dt><dd>{disposition(pillar.signal)}</dd></div>
              </dl>
              <p className={styles.technicalExplanation}>Contributions allocate the finished score. They are not independent forecasts or a linear formula for producing it.</p>
              <p className={styles.savedNarrative} data-saved-pillar-summary>{pillar.summary ?? 'A saved model narrative is not available for this context.'}</p>
            </details>
          </div>
        </article>
      ))}
    </div>
  );
}

function MarketPrices({ assets, tape }: { assets: ProAssetQuote[]; tape: WorkspaceMarketTape }) {
  const coreBasket = tape.entries.map((entry) => entry.ticker).join(', ');
  const supplementalQuotes = assets
    .filter((asset) => asset.dateSource === 'supplemental' && finite(asset.currentPrice) && asset.currentPrice > 0)
    .map((asset) => asset.ticker)
    .join(', ');
  return (
    <div className={styles.marketPanel} data-pro-market-prices>
      <h3>Across the market</h3>
      <p className={styles.contextNote} data-pro-core-basket>Summaries use the saved core basket: {coreBasket || 'Not available'}.</p>
      <dl className={styles.participation} aria-label="Saved core basket participation">
        <Metric label="Strongest" value={tape.strongest?.ticker ?? 'Not available'}><span className={tone(tape.strongest?.percentChange)}>{percentage(tape.strongest?.percentChange)}</span></Metric>
        <Metric label="Weakest" value={tape.weakest?.ticker ?? 'Not available'}><span className={tone(tape.weakest?.percentChange)}>{percentage(tape.weakest?.percentChange)}</span></Metric>
        <Metric label="Breadth" value={tape.breadth.total ? `${tape.breadth.advancers}/${tape.breadth.total}` : 'Not available'}>advancing in the saved core basket</Metric>
      </dl>
      <div className={styles.marketTableWrap} tabIndex={0} role="region" aria-label="Market prices and source dates, scroll horizontally if needed">
        <table className={`${styles.table} ${styles.marketTable}`}>
          <caption className={styles.srOnly}>Saved snapshot quotes and latest available supplemental daily quotes</caption>
          <thead><tr><th scope="col">Market</th><th scope="col">Price</th><th scope="col">Day move</th><th scope="col">Price date</th></tr></thead>
          <tbody>{assets.map((asset) => {
            const hasPrice = finite(asset.currentPrice) && asset.currentPrice > 0;
            const move = hasPrice ? asset.dailyChangePercent : null;
            return (
            <tr key={asset.ticker} data-pro-asset={asset.ticker} data-pro-quote-source={asset.dateSource ?? undefined}>
              <th scope="row">{asset.ticker.replace('-USD', '')}</th>
              <td>{price(asset.currentPrice, asset.ticker)}</td>
              <td className={tone(move)}>{percentage(move)}</td>
              <td>{hasPrice && asset.tradeDate ? <time dateTime={asset.tradeDate}>{asset.tradeDate}</time> : 'Not available'}{hasPrice && asset.dateSource === 'snapshot' ? <span className={styles.dateSource}>snapshot date</span> : null}</td>
            </tr>
            );
          })}</tbody>
        </table>
      </div>
      <p className={styles.quoteNote}>{supplementalQuotes ? `Supplemental quotes (${supplementalQuotes}) are excluded from these summaries. ` : 'Supplemental quotes are excluded from these summaries. '}Saved quotes and supplemental prices may use different dates. Snapshot quotes can differ from the chart’s daily closing prices.</p>
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
        <p className={styles.sampleNote}>{count(historical.candidateCount)} historical candidates across {count(historical.alignedSessionCount)} aligned sessions. {matchDateSpan(historical.matches)}</p>
        <p className={styles.sampleNote}>Averages describe the displayed following-session comparisons. This table may differ from the match set used to calculate the published score.</p>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Stock historical comparisons, scroll horizontally if needed">
          <table className={`${styles.table} ${styles.historyTable}`}>
            <caption className={styles.srOnly}>SPY outcomes in the session following each historical match</caption>
            <thead><tr><th scope="col">Matched session</th><th scope="col">Match score</th><th scope="col">Overnight gap</th><th scope="col">Open-to-close</th><th scope="col">Session range</th></tr></thead>
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
        <p className={styles.sampleNote}>Match score is a distance-based comparison, not a win probability. Gap compares the following open with the matched close; open-to-close compares that session’s close with its open; range compares its high with its low.</p>
      </>
    );
  }
  return (
    <>
      <dl className={styles.summaryMetrics}>
        <Metric label="Historical matches" value={`${historical.matchCount} sessions`} />
        <Metric label="Weighted average · next 1 session" value={percentage(historical.avg1d)} className={tone(historical.avg1d)} />
        <Metric label="Weighted average · next 3 sessions" value={percentage(historical.avg3d)} className={tone(historical.avg3d)} />
        <Metric label="Matches with a BTC decline" value={<>{finite(historical.bearish1d) ? `${Math.round(historical.bearish1d * 100)}%` : 'Not available'}<span className={styles.metricSecondary}>next 1 session</span></>}><span>{finite(historical.bearish3d) ? `${Math.round(historical.bearish3d * 100)}%` : 'Not available'} over the next 3 sessions</span></Metric>
      </dl>
      <p className={styles.sampleNote}>{matchDateSpan(historical.matches)}</p>
      <p className={styles.sampleNote}>BTC returns are close-to-close over the next one or three aligned daily sessions, including weekends. Averages weight closer matches more heavily; decline percentages count matches equally.</p>
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Crypto historical comparisons, scroll horizontally if needed">
        <table className={`${styles.table} ${styles.historyTable}`}>
          <caption className={styles.srOnly}>Following BTC close-to-close returns for each historical match</caption>
          <thead><tr><th scope="col">Matched session</th><th scope="col">Match score</th><th scope="col">BTC · next 1 session</th><th scope="col">BTC · next 3 sessions</th></tr></thead>
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
      <p className={styles.sampleNote}>Match score is a distance-based comparison, not a win probability. These historical outcomes describe the saved matches.</p>
      <details className={styles.matchDetails}>
        <summary>Match distances & weights</summary>
        <dl className={styles.matchRows}>{historical.matches.map((match) => <div key={match.tradeDate}><dt>{dateLabel(match.tradeDate)}</dt><dd>Distance {finite(match.distance) ? match.distance.toFixed(4) : 'Not available'} · Weight {finite(match.weight) ? match.weight.toFixed(4) : 'Not available'}</dd></div>)}</dl>
      </details>
    </>
  );
}

function ModelDiagnostics({ diagnostics, historical, tradeDate }: { diagnostics: ProDiagnostics; historical: ProStockComparisons | ProCryptoComparisons | null; tradeDate: string | null }) {
  return (
    <details className={styles.diagnostics} data-pro-model-settings>
      <summary>Model settings & diagnostics</summary>
      <div className={styles.diagnosticsBody}>
        <h3>Saved session</h3>
        <dl className={styles.diagnosticGrid}>
          <Metric label="Published session" value={dateLabel(tradeDate)} />
          <Metric label="Saved model version" value={diagnostics.modelVersion ?? 'Not available'} />
          <Metric label="Scoring matches" value={count(diagnostics.scoringMatchCount)} />
          <Metric label="Blended historical return" value={percentage(diagnostics.blendedForwardReturn)} />
          <Metric label="Created" value={diagnostics.createdAt ? <time dateTime={diagnostics.createdAt}>{diagnostics.createdAt}</time> : 'Not available'} />
          <Metric label="Updated" value={diagnostics.updatedAt ? <time dateTime={diagnostics.updatedAt}>{diagnostics.updatedAt}</time> : 'Not available'} />
          {historical?.kind === 'stocks' ? <>
            <Metric label="Aligned historical sessions" value={count(historical.alignedSessionCount)} />
            <Metric label="Historical candidates" value={count(historical.candidateCount)} />
            <Metric label="Historical price coverage" value={historical.featureTickers.join(', ') || 'Not available'} />
          </> : null}
        </dl>
        <h3>Current model settings</h3>
        <p className={styles.sampleNote}>These settings describe the current model. Older stored sessions may use a different model version.</p>
        <dl className={styles.diagnosticGrid}>{diagnostics.settings.map((setting) => <Metric key={setting.label} label={setting.label} value={setting.value}>{setting.description}</Metric>)}</dl>
      </div>
    </details>
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

export function ProWorkspace({ asset, published, signal, chart, pillars, assets, participation, historical, diagnostics, notice, actions, briefing }: {
  asset: ProductAsset;
  published: { tradeDate: string; score: number; label: string } | null;
  signal: TradableSignal | null;
  chart: WorkspaceData['active'];
  pillars: ProPillar[];
  assets: ProAssetQuote[];
  participation: WorkspaceMarketTape;
  historical: ProStockComparisons | ProCryptoComparisons | null;
  diagnostics: ProDiagnostics;
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
        <ProDecision asset={asset} tradeDate={tradeDate} signal={signal} />
      </div>
      <div className={styles.chart}>
        <MacroMarketChart
          variant="history" instrument={stocks ? 'SPY' : 'BTC'} title={`${stocks ? 'SPY' : 'BTC'} price & daily bias`} defaultRangeMonths={3}
          candles={chart.candles} marks={chart.history}
          latest={chart.score ? { tradeDate: chart.score.tradeDate, score: chart.score.score, biasLabel: chart.score.label } : null}
          notice={chart.historyNotice ?? chart.priceNotice ?? chart.loadError}
        />
        <p className={styles.chartNote}>Explore past sessions; the reading, model decision and briefing above stay on the published session.</p>
      </div>
      <section className={styles.evidence} aria-labelledby={`${asset}-evidence-heading`}>
        <header className={styles.sectionHeading}><h2 id={`${asset}-evidence-heading`}>What is shaping the reading</h2><p>Saved context for the published session.</p></header>
        <div className={styles.evidenceGrid}><ModelContext pillars={pillars} /><MarketPrices assets={assets} tape={participation} /></div>
      </section>
      <section className={styles.history} aria-labelledby={`${asset}-historical-heading`} data-pro-historical>
        <header className={styles.sectionHeading}><h2 id={`${asset}-historical-heading`}>What similar sessions did</h2><p>Historical comparisons for the published reading.</p></header>
        <HistoricalComparisons historical={historical} />
        <ModelDiagnostics diagnostics={diagnostics} historical={historical} tradeDate={tradeDate} />
      </section>
      {actions ? <div className={styles.utility}>{actions}</div> : null}
    </div>
  );
}
