import Link from 'next/link';

import { MacroMarketChart } from './MacroMarketChart';
import type { PublicDailyData } from '@/lib/product/public-daily-data';
import { ArrowIcon } from './ArrowIcon';
import { DailyPublicationNote } from './DailyPublicationNote';
import { DailyReadingRefresh } from './DailyReadingRefresh';
import { MarketTabs, MemberShell } from './MemberShell';
import { ProReading } from './ProReading';
import ui from './MemberUI.module.css';
import styles from './ProDailyPage.module.css';

function dateLabel(date: string) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

export function ProDailyPage({ data, briefing }: {
  data: PublicDailyData;
  briefing: { href: string | null; notice: string | null };
}) {
  const stocks = data.asset === 'stocks';
  const market = stocks ? 'stock' : 'crypto';
  const score = data.score;
  const archive = stocks ? '/briefings' : '/crypto/briefings';
  const workspace = stocks ? '/dashboard' : '/crypto/dashboard';
  const history = stocks ? '/track-record' : '/crypto/track-record';

  return (
    <MemberShell title={`Your ${market} reading`} description={score ? <>Published session · <time dateTime={score.tradeDate}>{dateLabel(score.tradeDate)}</time></> : 'Published session'} plan="Pro plan" headerActions={<>
      {briefing.href ? <Link className={ui.button} href={briefing.href}>Read full briefing</Link> : null}
      <Link className={ui.secondaryButton} href={archive}>Briefing archive</Link>
    </>}>
      <DailyReadingRefresh />
      <div data-pro-daily={data.asset}>
        <div className={styles.toolbar}>
          <MarketTabs asset={data.asset} />
        </div>
        {score ? (
          <div className={styles.current} data-current-session={score.tradeDate}>
            <ProReading asset={data.asset} tradeDate={score.tradeDate} score={score.score} label={score.label} />
          </div>
        ) : (
          <section className={ui.notice} aria-label="Published reading unavailable">
            <p>{data.loadError ? 'Your published reading is temporarily unavailable. Please try again.' : data.missingSessionDate ? `A reading for ${dateLabel(data.missingSessionDate)} has not been published yet.` : 'A published reading is not available yet.'}</p>
            <a className={ui.textLink} href={stocks ? '/today' : '/crypto'}>Reload reading<ArrowIcon /></a>
          </section>
        )}
        {score ? <DailyPublicationNote score={score} /> : null}
        <section className={styles.chart} aria-label="Price and score history">
          <MacroMarketChart candles={data.candles} marks={data.history} latest={score ? { tradeDate: score.tradeDate, score: score.score, biasLabel: score.label } : null} instrument={stocks ? 'SPY' : 'BTC'} title={`${stocks ? 'SPY' : 'Bitcoin'} price & daily bias`} variant="history" notice={[data.historyNotice, data.priceNotice].filter(Boolean).join(' ') || null} />
          <p className={styles.chartCaption}>Explore past sessions; the score above stays on the published session.</p>
        </section>
        <div className={styles.lower}>
          <section className={styles.brief} aria-labelledby="pro-session-brief-heading">
            <h2 id="pro-session-brief-heading">Session brief</h2>
            {score?.sentence ? <p>{score.sentence}</p> : <p>{briefing.notice || 'A briefing summary is not available for this session yet.'}</p>}
            {briefing.notice && score?.sentence ? <p className={styles.briefNotice}>{briefing.notice}</p> : null}
            <div className={ui.actions}>
              {briefing.href ? <Link className={ui.textLink} href={briefing.href}>Read full briefing<ArrowIcon /></Link> : null}
              <Link className={ui.textLink} href={archive}>Browse briefings<ArrowIcon /></Link>
            </div>
          </section>
          <nav className={styles.explore} aria-label="Reading shortcuts">
            <h2>Keep exploring</h2>
            <Link href={workspace}><span>Open workspace<small>Market moves, model context and historical matches.</small></span><ArrowIcon /></Link>
            <Link href={history}><span>Track record<small>Published readings and stored outcomes.</small></span><ArrowIcon /></Link>
            <Link href="/account"><span>Account & emails<small>Your plan and saved email preferences.</small></span><ArrowIcon /></Link>
          </nav>
        </div>
      </div>
    </MemberShell>
  );
}
