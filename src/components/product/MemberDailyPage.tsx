import Link from 'next/link';

import type { PublicDailyData } from '@/lib/product/public-daily-data';
import { ArrowIcon } from './ArrowIcon';
import { MacroMarketChart } from './MacroMarketChart';
import { MarketTabs, MemberShell, MemberUpgrade } from './MemberShell';
import ui from './MemberUI.module.css';
import styles from './MemberDailyPage.module.css';

const REGIMES: Record<string, { label: string; explanation: string; tone: string }> = {
  NEUTRAL: { label: 'Neutral', explanation: 'The stored regime is neutral: the model has not assigned a clear risk-on or risk-off backdrop to this session.', tone: 'neutral' },
  RISK_ON: { label: 'Risk-on', explanation: 'The model published a risk-on backdrop for this session. Use it as context alongside your own setup.', tone: 'positive' },
  EXTREME_RISK_ON: { label: 'Extreme risk-on', explanation: 'The model published a strong risk-on backdrop for this session. A strong reading does not guarantee the next move.', tone: 'positive' },
  RISK_OFF: { label: 'Risk-off', explanation: 'The model published a defensive, risk-off backdrop for this session. Use it as context alongside your own setup.', tone: 'negative' },
  EXTREME_RISK_OFF: { label: 'Extreme risk-off', explanation: 'The model published a strongly defensive backdrop for this session. A strong reading does not guarantee the next move.', tone: 'negative' },
};

function dateLabel(date: string) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

export function MemberDailyPage({ data }: { data: PublicDailyData }) {
  const stocks = data.asset === 'stocks';
  const score = data.score;
  const regime = score ? REGIMES[score.label] : null;
  const dashboard = stocks ? '/dashboard' : '/crypto/dashboard';
  const briefings = stocks ? '/briefings' : '/crypto/briefings';
  const history = stocks ? '/track-record' : '/crypto/track-record';
  return (
    <MemberShell title={`Your ${stocks ? 'stock' : 'crypto'} reading`} description={score ? <>Previous published session · <time dateTime={score.tradeDate}>{dateLabel(score.tradeDate)}</time></> : 'Previous published session'} plan="Free plan">
      <div data-member-daily={data.asset}>
        <MarketTabs asset={data.asset} />
        {score && regime ? (
          <section className={styles.reading} aria-label="Published reading">
            <div className={styles.score}>
              <p>{stocks ? 'Stock' : 'Crypto'} score</p>
              <strong>{score.score > 0 ? '+' : ''}{score.score}</strong>
              <span data-tone={regime.tone}>{regime.label}</span>
              <div className={styles.gauge} role="img" aria-label={`Score ${score.score} on a scale from minus 100 to plus 100`}><i data-tone={regime.tone} style={{ left: `${(score.score + 100) / 2}%` }} /></div>
              <div className={styles.scale}><span>−100</span><span>0</span><span>+100</span></div>
            </div>
            <div className={styles.interpretation}>
              <h2>What this reading means</h2><p>{regime.explanation}</p>
              <div className={ui.actions}><Link className={ui.textLink} href={dashboard}>Open dashboard<ArrowIcon /></Link><Link className={ui.textLink} href={briefings}>Read older briefings<ArrowIcon /></Link></div>
            </div>
          </section>
        ) : (
          <div className={ui.notice}>{data.loadError || 'A previous-session reading is not available yet.'}<div className={ui.actions}><Link className={ui.textLink} href={dashboard}>Open dashboard<ArrowIcon /></Link></div></div>
        )}
        <section className={styles.chart} aria-label="Price and score history">
          <MacroMarketChart candles={data.candles} marks={data.history} latest={score ? { tradeDate: score.tradeDate, score: score.score, biasLabel: score.label } : null} instrument={stocks ? 'SPY' : 'BTC'} title={`${stocks ? 'SPY' : 'Bitcoin'} price & daily bias`} variant="history" defaultRangeMonths={3} notice={[data.historyNotice, data.priceNotice].filter(Boolean).join(' ') || null} />
        </section>
        <div className={styles.lower}>
          <section><h2>How to read this score</h2><p>The scale runs from −100 to +100. Lower values lean toward risk-off conditions; higher values lean toward risk-on.</p><div className={styles.guide}><span>−100<small>Risk-off</small></span><span>0<small>Mixed</small></span><span>+100<small>Risk-on</small></span></div><p>The published regime is stored with each reading. It can differ from the score’s numeric tilt when the model finds no tradable edge.</p></section>
          <section><h2>Keep exploring</h2><Link className={styles.explore} href={history}><span>Track record<small>Review published readings and stored outcomes.</small></span><ArrowIcon /></Link><Link className={styles.explore} href="/account"><span>Email settings<small>Choose weekday stock and crypto updates.</small></span><ArrowIcon /></Link></section>
        </div>
        <MemberUpgrade />
      </div>
    </MemberShell>
  );
}
