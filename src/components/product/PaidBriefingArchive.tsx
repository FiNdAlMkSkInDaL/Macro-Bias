import Link from 'next/link';

import { getBriefingViewer, type PaidBriefingArchiveData } from '@/lib/product/paid-briefing-data';
import { briefingAccess, type BriefingViewer } from '@/lib/product/briefing-access';
import type { ProductAsset } from '@/lib/product/score-access';
import { getAppUrl } from '@/lib/server-env';
import { MemberShell, MarketTabs } from './MemberShell';
import { ArrowIcon } from './ArrowIcon';
import shared from './MemberUI.module.css';
import styles from './PaidBriefing.module.css';

export function briefingBasePath(asset: ProductAsset) {
  return asset === 'stocks' ? '/briefings' : '/crypto/briefings';
}

export function briefingScore(score: number | null) {
  return score === null ? 'Unavailable' : score > 0 ? `+${score}` : String(score);
}

export function briefingLabel(label: string) {
  if (label === 'UNAVAILABLE') return 'Reading unavailable';
  return label.replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function briefingTone(label: string) {
  return label === 'RISK_ON' || label === 'EXTREME_RISK_ON' ? shared.positive
    : label === 'RISK_OFF' || label === 'EXTREME_RISK_OFF' ? shared.negative : styles.neutral;
}

export function briefingDate(date: string, long = false) {
  return new Intl.DateTimeFormat('en-US', {
    ...(long ? { weekday: 'long' as const } : {}),
    month: long ? 'long' : 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

function StockArchiveStructuredData() {
  const appUrl = getAppUrl().replace(/\/$/, '');
  const faq = {
    '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [
      { '@type': 'Question', name: 'What is the Macro Bias score?', acceptedAnswer: { '@type': 'Answer', text: 'The Macro Bias score is a daily quantitative regime signal ranging from -100 to +100 that measures the net directional pressure across SPY, TLT, GLD, USO, and HYG. Positive scores indicate risk-on conditions; negative scores signal risk-off.' } },
      { '@type': 'Question', name: 'How often is the Macro Bias briefing updated?', acceptedAnswer: { '@type': 'Answer', text: 'The briefing updates every trading day. The algo recalculates after market data is available and publishes a fresh regime score, sector playbook, and K-NN diagnostics each session.' } },
      { '@type': 'Question', name: 'What does Risk On vs Risk Off mean for day traders?', acceptedAnswer: { '@type': 'Answer', text: 'Risk On means institutional capital is flowing into equities, credit, and commodities — continuation setups tend to work. Risk Off means capital is moving to bonds and gold — defensive postures and mean-reversion setups are favored.' } },
      { '@type': 'Question', name: 'What markets does the Macro Bias model track?', acceptedAnswer: { '@type': 'Answer', text: 'The model tracks five core ETFs: SPY (equities), TLT (bonds), GLD (gold), USO (oil), and HYG (high-yield credit). It also integrates VIX volatility and technical indicators like RSI, MACD, and moving average crossovers.' } },
      { '@type': 'Question', name: 'Is the Macro Bias briefing free?', acceptedAnswer: { '@type': 'Answer', text: 'Scores and published briefing listings are public. Signed-in Free accounts can read full briefings seven calendar days after first publication. Pro includes immediate full briefing access and current workspaces.' } },
    ],
  };
  const collection = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Daily Briefing Archive',
    description: 'Complete archive of daily macro regime briefings from the Macro Bias algo.', url: `${appUrl}/briefings`,
    isPartOf: { '@type': 'WebSite', name: 'Macro Bias', url: appUrl },
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faq).replace(/</g, '\\u003c') }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(collection).replace(/</g, '\\u003c') }} /></>;
}

export function releaseTime(timestamp: string) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(new Date(timestamp)) + ' UTC';
}

export async function PaidBriefingArchive({ asset, data, viewer: suppliedViewer }: { asset: ProductAsset; data: PaidBriefingArchiveData; viewer?: BriefingViewer }) {
  const viewer = suppliedViewer ?? await getBriefingViewer();
  const basePath = briefingBasePath(asset);
  const latest = data.items[0];
  return (
    <MemberShell title={asset === 'stocks' ? 'Stock briefings' : 'Crypto briefings'} description="Public readings and published full briefings. Free accounts can read the full text seven calendar days after publication; Pro includes immediate access." plan={viewer.isPro ? 'Pro plan' : viewer.signedIn ? 'Free plan' : undefined}>
      {asset === 'stocks' ? <StockArchiveStructuredData /> : null}
      <MarketTabs asset={asset} view="briefings" />
      <div className={styles.archiveToolbar}>
        <p className={shared.muted}>{data.loadError ? 'Archive unavailable' : `${data.items.length} published ${data.items.length === 1 ? 'session' : 'sessions'}`}</p>
        <div className={styles.links}>
          <Link className={shared.textLink} href={asset === 'stocks' ? '/dashboard' : '/crypto/dashboard'}>Open workspace<ArrowIcon /></Link>
          {latest ? <Link className={shared.textLink} href={`${basePath}/${latest.date}`}>Latest briefing<ArrowIcon /></Link> : null}
        </div>
      </div>
      <section className={shared.section} aria-labelledby="published-briefings-heading">
        <h2 id="published-briefings-heading">Published briefings</h2>
        {data.loadError ? <div className={shared.notice} role="status">{data.loadError} <Link className={shared.textLink} href={basePath}>Reload archive</Link></div>
          : data.items.length ? (
            <div className={shared.tableWrap} tabIndex={0} role="region" aria-label="Published briefings">
              <table className={`${shared.table} ${shared.stockTable} ${styles.archiveTable}`}>
                <thead><tr><th scope="col">Briefing date</th><th scope="col">Score</th><th scope="col">Regime</th><th scope="col">Full briefing access</th></tr></thead>
                <tbody>{data.items.map((item) => (
                  <tr key={item.date}>
                    <td><Link className={styles.dateLink} href={`${basePath}/${item.date}`}><time dateTime={item.date}>{briefingDate(item.date)}</time><ArrowIcon /></Link></td>
                    <td className={briefingTone(item.biasLabel)}>{briefingScore(item.score)}</td>
                    <td><span>{briefingLabel(item.biasLabel)}</span>{item.overrideActive ? <span className={styles.override}>Override active</span> : null}</td>
                    <td className={styles.accessCell}>{(() => {
                      const access = briefingAccess(viewer, item.publishedAt);
                      if (access.kind === 'pro') return 'Included with Pro';
                      if (access.kind === 'free') return 'Included with Free';
                      if (access.kind === 'sign-in') return 'Sign in to read · Free';
                      return <>Pro now{access.freeAvailableAt ? <small>Free from <time dateTime={access.freeAvailableAt}>{releaseTime(access.freeAvailableAt)}</time></small> : <small>Free release date unavailable</small>}</>;
                    })()}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className={shared.notice}>No {asset === 'stocks' ? 'stock' : 'crypto'} briefings are available.</div>}
      </section>
    </MemberShell>
  );
}
