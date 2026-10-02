import Link from 'next/link';

import type { PublicDailyData } from '@/lib/product/public-daily-data';
import { ArrowIcon } from './ArrowIcon';
import { DailyPublicationNote } from './DailyPublicationNote';
import { DailyReadingRefresh } from './DailyReadingRefresh';
import { HeroSignupForm } from './HeroSignupForm';
import { MacroMarketChart } from './MacroMarketChart';
import styles from './PublicDailyPage.module.css';

const MARKETS = {
  stocks: {
    name: 'Stocks',
    path: '/today',
    instrument: 'SPY',
    chartName: 'SPY',
    headline: 'Read the market behind',
    accent: 'your stock chart.',
    description: 'A daily stock score built from price momentum and signals across bonds, commodities and volatility.',
    contextTitle: 'A wider view of the market.',
    contextDescription: 'A stock chart shows price. Macro Bias also looks at the conditions around it.',
    inputs: [
      { title: 'Price momentum', description: 'How the S&P 500 is moving, and how market volatility is changing.' },
      { title: 'Risk appetite', description: 'What credit and government bonds suggest about demand for risk.' },
      { title: 'Cross-market rotation', description: 'How growth-sensitive commodities compare with gold, alongside energy momentum.' },
    ],
    trackRecord: '/track-record',
    trackRecordLabel: 'View the stock track record',
    signupHero: 'stock_daily_hero',
    signupFooter: 'stock_daily_footer',
  },
  crypto: {
    name: 'Crypto',
    path: '/crypto',
    instrument: 'BTC',
    chartName: 'Bitcoin',
    headline: 'See the bigger picture',
    accent: 'behind crypto.',
    description: 'A daily crypto score connecting Bitcoin momentum, Ethereum’s relative strength and wider macro conditions.',
    contextTitle: 'Crypto moves in a wider market.',
    contextDescription: 'Bitcoin has its own rhythm. Macro Bias also looks at the markets around it.',
    inputs: [
      { title: 'Bitcoin momentum', description: 'How Bitcoin’s price is moving, and how its volatility is changing.' },
      { title: 'Relative strength', description: 'How Ethereum compares with Bitcoin, and how Bitcoin compares with gold.' },
      { title: 'Macro conditions', description: 'What the US dollar and government bonds suggest about the wider backdrop.' },
    ],
    trackRecord: '/crypto/track-record',
    trackRecordLabel: 'View the crypto track record',
    signupHero: 'crypto_daily_hero',
    signupFooter: 'crypto_daily_footer',
  },
} as const;

const REGIMES: Record<string, { label: string; tone: 'neutral' | 'positive' | 'negative' }> = {
  NEUTRAL: { label: 'Neutral', tone: 'neutral' },
  RISK_ON: { label: 'Risk-on', tone: 'positive' },
  EXTREME_RISK_ON: { label: 'Extreme risk-on', tone: 'positive' },
  RISK_OFF: { label: 'Risk-off', tone: 'negative' },
  EXTREME_RISK_OFF: { label: 'Extreme risk-off', tone: 'negative' },
};

function displayDate(date: string) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`));
}

export function PublicDailyPage({ data }: { data: PublicDailyData }) {
  const market = MARKETS[data.asset];
  const score = data.score;
  const regime = score ? REGIMES[score.label] : null;
  const latest = score ? { tradeDate: score.tradeDate, score: score.score, biasLabel: score.label } : null;
  const latestPriceDate = data.availability.lastCandleDate;

  return (
    <main className={styles.page} data-public-daily={data.asset}>
      <DailyReadingRefresh />
      <nav className={styles.marketSwitch} aria-label="Daily market scores">
        <Link href="/today" aria-current={data.asset === 'stocks' ? 'page' : undefined}>Stocks</Link>
        <Link href="/crypto" aria-current={data.asset === 'crypto' ? 'page' : undefined}>Crypto</Link>
      </nav>

      <section className={styles.hero} aria-labelledby="daily-heading">
        <div className={styles.heroCopy}>
          <h1 id="daily-heading">{market.headline}<span>{market.accent}</span></h1>
          <p className={styles.description}>{market.description}</p>
        </div>
        <section className={styles.reading} aria-labelledby="public-reading-heading" data-public-reading>
          <div className={styles.readingHeader}>
            <h2 id="public-reading-heading">{market.name} today</h2>
            <div>
              <p>Latest reading</p>
              {score ? <time dateTime={score.tradeDate}>{displayDate(score.tradeDate)}</time> : <span>Awaiting a reading</span>}
            </div>
          </div>
          {score && regime ? (
            <>
              <div className={styles.scoreLine}>
                <p className={`${styles.score} ${styles[regime.tone]}`}>{score.score > 0 ? '+' : ''}{score.score}</p>
                <p className={styles.regime}>{regime.label}</p>
              </div>
              <div className={styles.scale} aria-hidden="true">
                <div className={styles.scaleTrack}><span className={styles[`${regime.tone}Marker`]} style={{ left: `${(score.score + 100) / 2}%` }} /></div>
                <div className={styles.scaleLabels}><span>−100</span><span>0</span><span>+100</span></div>
              </div>
            </>
          ) : (
            <div className={styles.unavailable}>
              <h3>{data.loadError ? 'Reading temporarily unavailable.' : 'The next reading is on its way.'}</h3>
              <p>{data.loadError ?? 'A public score will appear here after a session has been published. Join the free email updates below.'}</p>
            </div>
          )}
          <dl className={styles.priceDate}>
            <div>
              <dt>{market.instrument} price close</dt>
              <dd>{latestPriceDate ? <time dateTime={latestPriceDate}>{displayDate(latestPriceDate)}</time> : 'Not available'}</dd>
            </div>
          </dl>
          {data.priceNotice ? <p className={styles.status} role="status">{data.priceNotice}</p> : null}
          {data.missingSessionDate && score ? (
            <p className={styles.status}>Awaiting a reading for <time dateTime={data.missingSessionDate}>{displayDate(data.missingSessionDate)}</time>.</p>
          ) : null}
          {score ? (
            <details className={styles.provenance}>
              <summary>Publication &amp; model source<ArrowIcon /></summary>
              <DailyPublicationNote score={score} variant="detail" />
            </details>
          ) : null}
        </section>
        <div className={styles.signup}>
          <p className={styles.signupLabel}>Free daily stock + crypto scores and market updates.</p>
          <HeroSignupForm location={market.signupHero} pagePath={market.path} />
        </div>
      </section>

      <section className={styles.history} aria-labelledby="history-heading">
        <h2 id="history-heading">Put the reading in perspective.</h2>
        <p>{market.chartName} price and daily {data.asset === 'crypto' ? 'crypto ' : ''}Macro Bias.</p>
        <MacroMarketChart
          variant="history"
          instrument={market.instrument}
          title={`${market.chartName} price + daily bias`}
          candles={data.candles}
          marks={data.history}
          latest={latest}
          notice={[data.historyNotice, data.priceNotice, data.loadError].filter(Boolean).join(' ') || null}
        />
      </section>

      <section className={styles.context} aria-labelledby="context-heading">
        <h2 id="context-heading">{market.contextTitle}</h2>
        <p className={styles.sectionDescription}>{market.contextDescription}</p>
        <ol className={styles.inputs}>
          {market.inputs.map((input, index) => (
            <li key={input.title}>
              <span className={styles.inputNumber}>0{index + 1}</span>
              <h3>{input.title}</h3>
              <p>{input.description}</p>
            </li>
          ))}
        </ol>
        <div className={styles.methodology}>
          <p>The model compares these conditions with similar historical sessions and their following market returns.</p>
          <Link href="/about" className={styles.textLink}>About Macro Bias <ArrowIcon /></Link>
        </div>
      </section>

      <section className={styles.pro} aria-labelledby="pro-heading">
        <div>
          <h2 id="pro-heading">Go beyond the score.</h2>
          <p>A detailed briefing, trading permission, reliability grade and size guidance for the current session.</p>
        </div>
        <div className={styles.proActions}>
          <Link href="/pricing" className={styles.primaryLink} data-analytics-event="daily_pro_click" data-analytics-location={`${data.asset}_daily_pro`}>Explore Pro <ArrowIcon /></Link>
          <Link href={market.trackRecord} className={styles.textLink}>{market.trackRecordLabel} <ArrowIcon /></Link>
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="closing-heading">
        <h2 id="closing-heading">Keep the bigger picture<br className={styles.desktopBreak} /> in your inbox.</h2>
        <div>
          <p>Get the daily stock and crypto scores with a short market update, free by email.</p>
          <HeroSignupForm location={market.signupFooter} pagePath={market.path} />
        </div>
      </section>
    </main>
  );
}
