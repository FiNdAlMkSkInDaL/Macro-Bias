import type { Metadata } from 'next';
import Link from 'next/link';
import { getAnalyticsAdminUser } from '@/lib/analytics/admin-access';
import { xTestReport } from '@/lib/social/x-experiment';
import styles from '../analytics.module.css';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const metadata: Metadata = { title: 'X commentary test', robots: { index: false, follow: false } };
const blockedReasons: Record<string, string> = {
  fresh_publication_unavailable: 'Fresh briefing unavailable', publication_read_unavailable: 'Briefing data could not be read',
  verified_market_commentary_unavailable: 'Price inputs missing or inconsistent', post_length_invalid: 'Commentary exceeds the post limit',
  x_account_mismatch: 'Connected X account is incorrect', publisher_unavailable: 'X connection needs checking',
  previous_outcome_needs_review: 'Previous send needs review', publication_outcome_needs_review: 'Send outcome needs review',
  delivery_read_unavailable: 'Delivery history unavailable', claim_unavailable: 'Could not reserve this post', slot_already_claimed: 'Post reserved by another run',
};

export default async function XTestPage() {
  if (!await getAnalyticsAdminUser()) return <main className={styles.page}><div className={styles.container}><h1 className={styles.title}>Owner analytics</h1><p>This report is available to the site owner's analytics accounts.</p><Link className={styles.outlineButton} href="/login">Sign in with the owner account</Link></div></main>;
  let report;
  try { report = await xTestReport(); } catch {
    return <main className={styles.page}><div className={styles.container}><h1 className={styles.title}>X test report unavailable</h1><p>Delivery or acquisition data could not be read. Results are unknown; reload to try again.</p></div></main>;
  }
  const metrics = report.first.metrics;
  const phase = report.phase === 'before_start' ? 'Starts 28 October' : report.phase === 'running' ? 'Running' : 'Publishing window ended';
  const live = process.env.VERCEL_ENV === 'production' && process.env.X_COMMENTARY_MODE === 'live';
  return <main className={styles.page}><div className={styles.container}>
    <header className={styles.header}><div><h1 className={styles.title}>X commentary test</h1><p className={styles.subtitle}>28 October–10 November 2026 · eight planned posts · all times UTC</p></div><Link className={styles.outlineButton} href="/analytics">Acquisition analytics</Link></header>
    <p>{phase}. Automatic publishing is {report.phase === 'ended' ? 'stopped' : live ? 'enabled for this window' : 'disabled (preview only)'}. Stocks: Tuesday/Thursday. Crypto: Wednesday/Friday. First attempt 15:00; recovery check 15:30. Missing data is logged; uncertain sends are held for review.</p>
    {report.phase === 'before_start' ? <p className={styles.tableNote}>These are setup baseline counts. No posts from this test are scheduled before 28 October, so this is not campaign performance evidence.</p> : null}
    <div className={styles.kpis}>{[['Tracked visitors', metrics?.visitors], ['Page views', metrics?.pageViews], ['New subscribers', metrics?.newSubscribers], ['Verified first paid conversions', metrics?.paidConversions]].map(([label, value]) => <section key={label} className={styles.kpi}><h2>{label}</h2><p className={styles.kpiValue}>{value ?? 'N/A'}</p></section>)}</div>
    <p className={styles.tableNote}>Primary measure: first touch, campaign {report.experiment.id}. Stocks: {report.first.newsletters?.stocks ?? 'N/A'}; crypto: {report.first.newsletters?.crypto ?? 'N/A'}; both: {report.first.newsletters?.both ?? 'N/A'}; unknown preference: {report.first.newsletters?.unknown ?? 'N/A'}. A person choosing both counts once overall and in each newsletter column. Subscription records do not establish email verification or engagement.</p>
    <p className={styles.tableNote}>Latest-touch assist, separately: {report.latestAssist.metrics?.newSubscribers ?? 'N/A'} subscribers, {report.latestAssist.metrics?.paidConversions ?? 'N/A'} paid conversions. Never add assists to first-touch totals. Missing consent and attribution leave real traffic unmeasured.</p>
    {report.first.coverage.warnings.map(warning => <p className={styles.tableNote} key={warning}>{warning}</p>)}
    <h2>Publishing schedule and delivery health</h2>
    <div style={{ overflowX: 'auto', margin: '20px 0 32px' }}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 650 }}><thead><tr>{['Date', 'Newsletter', 'Delivery', 'First-touch subscribers', 'X impressions'].map(label => <th key={label} style={{ padding: 12 }}>{label}</th>)}</tr></thead><tbody>{report.plan.map(slot => {
      const delivery = report.deliveries.find(d => d.market === slot.market && d.date === slot.date);
      const run = report.runs.find(d => d.market === slot.market && d.date === slot.date);
      const post = report.first.posts?.find(p => p.key === `${slot.market}_${slot.date.replaceAll('-', '')}`);
      const engagement = report.latestCheckpoint?.engagement?.posts?.find((p: { id: string }) => p.id === delivery?.remote_id);
      const overdue = `${slot.date}T16:00:00.000Z` < report.capturedAt;
      const status = delivery?.status === 'published' ? 'Published' : delivery ? 'Outcome needs review' : run?.reason ? blockedReasons[run.reason] ?? 'Publishing blocked; check server logs' : (overdue ? 'No successful delivery recorded' : 'Scheduled');
      return <tr key={slot.date} style={{ borderTop: '1px solid #29372e' }}><td style={{ padding: 12 }}>{slot.date}</td><td style={{ padding: 12 }}>{slot.market}</td><td style={{ padding: 12 }}>{delivery?.status === 'published' && /^\d+$/.test(delivery.remote_id ?? '') ? <a href={`https://x.com/macro_bias/status/${delivery.remote_id}`} target="_blank" rel="noopener noreferrer">{status} ↗</a> : status}</td><td style={{ padding: 12 }}>{report.first.complete ? post?.newSubscribers ?? 0 : 'N/A'}</td><td style={{ padding: 12 }}>{engagement?.impressions ?? 'Unavailable'}</td></tr>;
    })}</tbody></table></div>
    <p className={styles.tableNote}>X engagement is a daily API sample, not a live counter. Unavailable access is never zero. The final hosted checkpoint runs 11 November. Acquisition analytics continue collecting later arrivals under the same campaign.</p>
    <Link className={styles.outlineButton} href={`/analytics?preset=custom&start=${report.first.range.startDate}&end=${report.capturedAt.slice(0, 10)}&source=x&campaign=${report.experiment.id}&touch=first`}>Open campaign breakdown</Link>
  </div></main>;
}
