import type { Metadata } from 'next';
import Link from 'next/link';
import { getAnalyticsAdminUser } from '@/lib/analytics/admin-access';
import { getTurnaroundReport } from '@/lib/analytics/turnaround-report';
import styles from '../analytics.module.css';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const metadata: Metadata = { title: 'Acquisition turnaround scorecard', robots: { index: false, follow: false } };

export default async function TurnaroundPage() {
  if (!await getAnalyticsAdminUser()) return <main className={styles.page}><div className={styles.container}><h1 className={styles.title}>Private acquisition scorecard</h1><p>Sign in with the owner account to view acquisition results.</p><Link href="/login">Sign in</Link></div></main>;
  let report;
  try { report = await getTurnaroundReport(); } catch { return <main className={styles.page}><div className={styles.container}><h1 className={styles.title}>Acquisition unavailable</h1><p>The report could not be read. Results are unknown, not zero.</p></div></main>; }
  const m = report.first?.metrics, choices = report.first?.newsletters, goals = report.policy.targets;
  return <main className={styles.page}><div className={styles.container}>
    <header className={styles.header}><div><h1 className={styles.title}>Acquisition turnaround</h1><p className={styles.subtitle}>4–17 November 2026 · review 18 November · {report.phase}</p></div><Link href="/analytics">All acquisition</Link></header>
    <p>Free directory placements, the X profile link and new public resources. The original eight-post X experiment stays separate and ends as planned. This is an observational test of several changes, not a controlled causal comparison.</p>
    <div className={styles.kpis}>{[['Identified visitors', m?.visitors, goals.identifiedVisitors], ['Unique new subscribers', m?.newSubscribers, goals.uniqueSubscribers], ['Stocks signups', choices?.stocks, goals.stocks], ['Crypto signups', choices?.crypto, goals.crypto]].map(([label, value, goal]) => <section className={styles.kpi} key={label}><h2>{label}</h2><p className={styles.kpiValue}>{value ?? 'Unavailable'}</p><p>Working target: {goal}</p></section>)}</div>
    <p className={styles.tableNote}>Targets are planning goals, not forecasts. Primary measure: first-touch campaign {report.policy.campaign}. A person choosing both counts once in unique subscribers and in both newsletter columns. Both: {choices?.both ?? 'Unavailable'}; original preference unknown: {choices?.unknown ?? 'Unavailable'}. Verified first paid conversions: {m?.paidConversions ?? 'Unavailable'}.</p>
    <h2>Where tagged acquisition came from</h2>
    {report.first?.complete ? <div style={{ overflowX: 'auto', margin: '20px 0' }}><table style={{ minWidth: 620, width: '100%', textAlign: 'left' }}><thead><tr>{['Source', 'Medium', 'Views', 'Identified visitors', 'New subscribers', 'First paid'].map(label => <th key={label} style={{ padding: 10 }}>{label}</th>)}</tr></thead><tbody>{report.first.sources?.map(row => <tr key={row.key}><td style={{ padding: 10 }}>{row.source}</td><td>{row.medium}</td><td>{row.pageViews}</td><td>{row.visitors}</td><td>{row.newSubscribers}</td><td>{row.paidConversions}</td></tr>)}</tbody></table>{!report.first.sources?.length ? <p>No attributed campaign activity recorded yet.</p> : null}</div> : <p>Campaign data incomplete or not yet available. No zero is substituted.</p>}
    <p>Latest-touch assists, separately: {report.latestAssist?.metrics?.newSubscribers ?? 'Unavailable'} subscribers and {report.latestAssist?.metrics?.paidConversions ?? 'Unavailable'} first paid conversions. Never add assists to the primary totals.</p>
    <h2>New resource entry pages</h2>
    <p>{report.resourceEntries?.note}</p>
    {report.resourceEntries?.complete ? <ul>{report.resourceEntries.rows?.map(row => <li key={row.key}>{row.label}: {row.pageViews} page views; {row.visitors} identified visitors; {row.newSubscribers} first-touch subscribers</li>)}</ul> : <p>Entry-page data unavailable.</p>}
    {report.resourceEntries?.complete && !report.resourceEntries.rows?.length ? <p>No recorded entries to the new resources yet.</p> : null}
    <h2>How to decide what to change</h2>
    <p>Little exposure or few visits calls for a distribution review. Visits without subscriptions calls for an offer/sample review. Small samples cannot establish profitability or prove that the newsletter is ineffective. Newsletter creation does not prove email verification or engagement.</p>
    <p>Consent-free views are aggregate counts only. Missing consent, source attribution or incomplete reads leave the unique audience and conversion rate unknown. Internal, bot, test, reactivation and legacy exclusions are retained.</p>
    {report.first?.coverage.warnings.map(w => <p className={styles.tableNote} key={w}>{w}</p>)}
    <Link href={`/analytics?preset=custom&start=2026-11-04&end=${report.first?.range.endDate ?? report.policy.end}&campaign=${report.policy.campaign}&touch=first`}>Open full campaign breakdown</Link>
  </div></main>;
}
