import Link from 'next/link';

import { PaywallWrapper } from '@/components/paywall-wrapper';
import type { WorkspaceData, WorkspaceTickerChange } from '@/lib/product/workspace-data';
import type { ViewerScore } from '@/lib/product/score-access';
import { ArrowIcon } from './ArrowIcon';
import { MacroMarketChart } from './MacroMarketChart';
import styles from './FreeWorkspace.module.css';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const priceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function dateLabel(date: string) {
  return dateFormatter.format(new Date(`${date}T00:00:00Z`));
}

function scoreLabel(score: number) {
  return `${score > 0 ? '+' : ''}${score}`;
}

function biasLabel(label: string) {
  return label.toLowerCase().split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function changeLabel(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function Reading({ name, score, href, error }: { name: 'Stocks' | 'Crypto'; score: ViewerScore | null; href: string; error: string | null }) {
  return (
    <article className={styles.reading} data-workspace-reading={name.toLowerCase()}>
      <h2>{name}</h2>
      {score ? (
        <>
          <div className={styles.scoreLine}>
            <p className={styles.score}>{scoreLabel(score.score)}</p>
            <p className={styles.bias}>{biasLabel(score.label)}</p>
          </div>
          <div className={styles.readingFoot}>
            <p><span className={styles.label}>Previous published session</span><time dateTime={score.tradeDate}>{dateLabel(score.tradeDate)}</time></p>
            <Link href={href}>Open {name === 'Stocks' ? 'stock' : 'crypto'} reading <ArrowIcon /></Link>
          </div>
        </>
      ) : (
        <div className={styles.readingEmpty}>
          <p>{error ?? 'A previous-session reading is not available yet.'}</p>
          <Link href={href}>Open {name === 'Stocks' ? 'stock' : 'crypto'} reading <ArrowIcon /></Link>
        </div>
      )}
    </article>
  );
}

function Move({ entry }: { entry: WorkspaceTickerChange | null }) {
  if (!entry) return <dd>Not available</dd>;
  return (
    <dd>
      <strong>{entry.ticker}</strong> <span data-tone={entry.percentChange > 0 ? 'positive' : entry.percentChange < 0 ? 'negative' : 'neutral'}>{changeLabel(entry.percentChange)}</span>
      <time dateTime={entry.tradeDate}>{dateLabel(entry.tradeDate)}{entry.dateSource === 'snapshot' ? ' · snapshot' : ''}</time>
    </dd>
  );
}

function emailSummary(data: WorkspaceData) {
  const preferences = data.alerts.preferences;
  if (!preferences) return data.alerts.notice ?? 'Email preferences are not available.';
  if (preferences.stocksOptedIn && preferences.cryptoOptedIn) return 'Stocks and crypto are on.';
  if (preferences.stocksOptedIn) return 'Stock updates are on. Crypto updates are off.';
  if (preferences.cryptoOptedIn) return 'Crypto updates are on. Stock updates are off.';
  return 'Weekday email updates are off.';
}

function stockExplanation(data: WorkspaceData) {
  const score = data.active.score;
  const context = data.stockContext;
  if (!context || !score) return 'A saved position is not available for this session.';
  if (score.label === 'NEUTRAL' && Math.abs(score.score) <= 10 && context.permission === 'FLAT') {
    return 'The published score is near neutral, and the saved position is cash.';
  }
  const regime = biasLabel(score.label).toLowerCase();
  const position = context.permission === 'LONG' ? 'long' : context.permission === 'SHORT' ? 'short' : 'cash';
  return context.permission === 'NO_TRADE'
    ? `The published regime is ${regime}, and the saved permission is no trade.`
    : `The published regime is ${regime}, and the saved position is ${position}.`;
}

export function FreeWorkspace({ data, audience = 'member', userId }: {
  data: WorkspaceData;
  audience?: 'member' | 'public';
  userId: string | null;
}) {
  const stocks = data.asset === 'stocks' ? data.active : data.otherMarket;
  const crypto = data.asset === 'crypto' ? data.active : data.otherMarket;
  const score = data.active.score;
  const instrument = data.asset === 'stocks' ? 'SPY' : 'BTC';
  const context = data.stockContext;
  const marketName = data.asset === 'stocks' ? 'stock' : 'crypto';
  const dailyHref = data.asset === 'stocks' ? '/today' : '/crypto';
  const historyHref = data.asset === 'stocks' ? '/track-record' : '/crypto/track-record';
  const accountHref = audience === 'member' ? '/account' : '/login?redirectTo=/account';
  const rows = [
    { title: 'Daily reading', description: 'See the score and what its regime means.', href: dailyHref },
    { title: 'Track record', description: 'Review published readings and stored outcomes.', href: historyHref },
    { title: 'Referrals', description: 'Find your link and earned rewards.', href: '/refer' },
    { title: 'Email settings', description: 'Choose weekday stock and crypto updates.', href: accountHref },
  ];
  const offer = (
    <section className={`${styles.panel} ${styles.offer}`} aria-labelledby="workspace-pro-heading">
      <div><h2 id="workspace-pro-heading">Get the full market read</h2><p>Pro adds the current workspace reading, full briefing, permission, reliability and suggested size.</p></div>
      <Link href="/pricing" className={styles.primaryLink}>Explore Pro</Link>
    </section>
  );

  return (
    <main className={styles.page} data-member-page data-free-workspace={data.asset}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleLine}><h1>Your market overview</h1><span>Free plan</span></div>
          <p>Read the previous published session, explore its history, and choose what reaches your inbox.</p>
          <nav className={styles.marketSwitch} aria-label="Dashboard markets">
            <Link href="/dashboard" aria-current={data.asset === 'stocks' ? 'page' : undefined}>Stocks</Link>
            <Link href="/crypto/dashboard" aria-current={data.asset === 'crypto' ? 'page' : undefined}>Crypto</Link>
          </nav>
        </header>

        <section className={`${styles.panel} ${styles.readings}`} aria-label="Previous published market readings">
          <Reading name="Stocks" score={stocks.score} href="/today" error={stocks.loadError} />
          <Reading name="Crypto" score={crypto.score} href="/crypto" error={crypto.loadError} />
        </section>

        <div className={styles.history}>
          <MacroMarketChart
            variant="history" instrument={instrument} title={`${instrument} price & daily bias`}
            candles={data.active.candles} marks={data.active.history}
            latest={score ? { tradeDate: score.tradeDate, score: score.score, biasLabel: score.label } : null}
            notice={data.active.historyNotice ?? data.active.priceNotice ?? data.active.loadError}
          />
        </div>

        {data.asset === 'stocks' ? (
          <section className={styles.panel} aria-labelledby="workspace-context-heading" data-stock-session-context>
            <div className={styles.sectionHeading}>
              <div><h2 id="workspace-context-heading">Previous-session stock context</h2><p>Your previous published stock reading, with the key fields that were saved.</p></div>
              <div className={styles.date}><span>Session date</span>{score ? <time dateTime={score.tradeDate}>{dateLabel(score.tradeDate)}</time> : <p>Not available</p>}</div>
            </div>
            <dl className={styles.contextFields}>
              <div><dt>Permission</dt><dd>{context?.permission ?? '—'}<span className={styles.metricDefinition}>Saved position: long, short, cash or no trade.</span></dd></div>
              <div><dt>Size</dt><dd>{context?.sizePct != null ? `${context.sizePct}%` : '—'}</dd></div>
              <div><dt>Reliability</dt><dd>{context?.reliability ?? '—'}<span className={styles.metricDefinition}>Model grade combining agreement and match closeness.</span></dd></div>
              <div><dt>Agreement</dt><dd>{context?.agreementPct != null ? `${context.agreementPct}%` : '—'}<span className={styles.metricDefinition}>{score?.score === 0 ? 'Share of historical matches with near-flat returns.' : 'Share of historical matches aligned with the score’s direction.'}</span></dd></div>
              <div className={styles.reason}><dt>Reason</dt><dd><p data-stock-reason>{stockExplanation(data)}</p>{context?.reason ? <details className={styles.modelDetails}><summary>Model details</summary><p data-saved-model-reason>{context.reason}</p></details> : null}</dd></div>
            </dl>
            <p className={styles.metricNote}>Agreement describes historical matches, not a win probability.</p>
            {data.stockContextNotice ? <p className={styles.notice}>{data.stockContextNotice}</p> : null}
          </section>
        ) : (
          <section className={styles.panel} aria-labelledby="workspace-context-heading" data-crypto-session-context>
            <div className={styles.sectionHeading}>
              <div><h2 id="workspace-context-heading">Previous-session crypto context</h2><p>Stored market participation for this published reading.</p></div>
              <div className={styles.date}><span>Snapshot date</span>{data.tape.tradeDate ? <time dateTime={data.tape.tradeDate}>{dateLabel(data.tape.tradeDate)}</time> : <p>Not available</p>}</div>
            </div>
            <dl className={styles.cryptoFields}>
              <div><dt>Strongest</dt><Move entry={data.tape.strongest} /></div>
              <div><dt>Weakest</dt><Move entry={data.tape.weakest} /></div>
              <div><dt>Breadth</dt><dd>{data.tape.breadth.total ? <><strong>{data.tape.breadth.advancers}/{data.tape.breadth.total}</strong> advancing<span className={styles.breadthDetail}>{data.tape.breadth.decliners} declining · {data.tape.breadth.unchanged} unchanged</span></> : 'Not available'}</dd></div>
            </dl>
          </section>
        )}

        <section className={styles.panel} aria-labelledby="workspace-tape-heading">
          <div className={styles.sectionHeading}>
            <div><h2 id="workspace-tape-heading">Market tape</h2><p>Key markets from the previous published {marketName} snapshot.</p></div>
            <div className={styles.date}><span>Snapshot date</span>{data.tape.tradeDate ? <time dateTime={data.tape.tradeDate}>{dateLabel(data.tape.tradeDate)}</time> : <p>Not available</p>}</div>
          </div>
          <p className={styles.tapeNote}>Saved quotes use their listed price dates, which may precede the snapshot. Snapshot quotes can differ from the chart’s daily closing prices.</p>
          {data.tape.entries.length ? (
            <div className={styles.tableScroll}>
              <table className={styles.tape}>
                <thead><tr><th>Symbol</th><th>Close</th><th>Change</th><th>Price date</th></tr></thead>
                <tbody>{data.tape.entries.map((entry) => (
                  <tr key={entry.ticker}><th scope="row">{entry.ticker}</th><td>{priceFormatter.format(entry.close)}</td><td data-tone={entry.percentChange > 0 ? 'positive' : entry.percentChange < 0 ? 'negative' : 'neutral'}>{changeLabel(entry.percentChange)}</td><td><time dateTime={entry.tradeDate}>{dateLabel(entry.tradeDate)}</time>{entry.dateSource === 'snapshot' ? <span className={styles.sourceDate}>Snapshot date</span> : null}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className={styles.notice}>{data.tape.notice ?? 'Market moves are not available for this session.'}</p>}
        </section>

        <section className={styles.panel} aria-labelledby="workspace-continue-heading">
          <div className={styles.sectionHeading}><div><h2 id="workspace-continue-heading">Continue your reading</h2><p>Pick up where you left off.</p></div></div>
          <div className={styles.readingRows}>{rows.map((row) => <Link href={row.href} key={row.title}><strong>{row.title}</strong><span>{row.description}</span><ArrowIcon /></Link>)}</div>
        </section>

        <section className={`${styles.panel} ${styles.emailUtility}`} aria-labelledby="workspace-emails-heading" data-workspace-email-status={data.alerts.preferences ? 'verified' : 'unavailable'}>
          <div><h2 id="workspace-emails-heading">Your weekday emails</h2><p>{audience === 'member' ? emailSummary(data) : 'Sign in to see and manage your email preferences.'}</p></div>
          <Link href={accountHref}>{audience === 'member' ? 'Manage preferences' : 'Sign in'} <ArrowIcon /></Link>
        </section>

        <PaywallWrapper initialIsPro={false} userId={userId} lockedContent={offer}>{null}</PaywallWrapper>
      </div>
    </main>
  );
}
