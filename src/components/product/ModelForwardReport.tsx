import Link from 'next/link';
import type { summarizeForward } from '@/lib/model-forward/service';
import { MODEL_FORWARD } from '@/lib/model-forward/recipe';
import styles from '@/app/analytics/analytics.module.css';
const names: Record<string, string> = { cash: 'Zero return / 50:50 / cash', always_up: 'Always up, daily entry/exit', trailing_mean: 'Past average', momentum_20: '20-session momentum', momentum_60: '60-session momentum',
  production_raw: 'Current engine, raw sign', production_filtered: 'Current engine, trading filters', aligned_shrunk_analog: '40-match shrunk analogue', aligned_ridge: 'Regularized regression', constant: 'Past constant risk', ewma: 'Adaptive risk (EWMA)', shrink_50: 'Crypto risk blend (50/50)' };
const number = (n: number | null | undefined, digits = 4) => n == null ? 'Unavailable' : n.toFixed(digits);
const interval = (v: number[] | null) => v ? `[${v.map(n => n.toFixed(4)).join(', ')}]` : 'Insufficient completed sessions';
const tableStyle = { width: '100%', borderCollapse: 'collapse' as const, textAlign: 'left' as const, minWidth: 700 };
const cell = { padding: 12, borderBottom: '1px solid #29372e' };
export function ModelForwardReport({ report }: { report: ReturnType<typeof summarizeForward> }) {
  const lastHealth = typeof report.latestHealth?.checkedAt === 'string' ? report.latestHealth.checkedAt : null;
  const stale = !lastHealth || Date.now() - Date.parse(lastHealth) > 36 * 3_600_000;
  const ended = new Date().toISOString() >= MODEL_FORWARD.settlementEnd;
  return <main className={styles.page}><div className={styles.container}>
    <header className={styles.header}><div><h1 className={styles.title}>Model forward test</h1><p className={styles.subtitle}>Stocks and crypto · future sessions only · 28 October 2026–31 January 2027</p></div><Link className={styles.outlineButton} href="/analytics">Acquisition analytics</Link></header>
    <p>Each forecast is saved before its target opens, then graded after the completed price is available. Stocks use SPY open-to-close. Crypto uses the full UTC session two calendar days after its source close. No trades are placed. The scheduled collection runs between 09:00 and 10:00 UTC daily on the current hosting plan; the stock publisher offers an additional recovery opportunity before the open.</p>
    <p className={styles.tableNote}>Capture stops before 1 February; final settlement ends 3 February. Review requires at least {MODEL_FORWARD.minimumCompletedPerMarket} completed sessions per market and unchanged algorithm cohort. Trading claims additionally require {MODEL_FORWARD.minimumActiveForTradingClaims} active decisions and cost-robust evidence. No model is promoted automatically.</p>
    <p role="status">Collection: {ended ? 'finished' : process.env.MODEL_FORWARD_MODE === 'paused' ? 'paused' : stale ? 'first run pending or daily checkpoint overdue' : report.latestHealth?.ok === false ? 'attention required; latest run reported a failure' : 'latest run healthy'}. Last checkpoint: {lastHealth ?? 'not recorded yet'}.</p>
    {report.invalid ? <p role="alert">{report.invalid} record(s) failed eligibility or integrity checks. They are excluded and need investigation.</p> : null}
    {!report.cohorts.length ? <p>No qualifying hosted predictions have been saved yet. There are no performance results to assess.</p> : null}
    {(['stocks', 'crypto'] as const).filter(m => !report.cohorts.some(c => c.market === m)).map(m => <p key={m}>{m === 'stocks' ? 'Stocks' : 'Crypto'}: awaiting its first qualifying forecast. A missed target is never backfilled.</p>)}
    {report.cohorts.map(cohort => <section key={cohort.key} style={{ margin: '32px 0' }}>
      <h2>{cohort.market === 'stocks' ? 'Stocks' : 'Crypto'} · algorithm {cohort.modelHash.slice(0, 12)}</h2>
      <p>{cohort.locked} locked predictions · {cohort.completed} completed · {cohort.pending} pending. {cohort.reviewReady ? 'Minimum sample reached; review the losses, uncertainty and stability before making a decision.' : `Collecting evidence: ${MODEL_FORWARD.minimumCompletedPerMarket - cohort.completed} more completed sessions needed for the initial review.`}</p>
      {!cohort.models ? <p>Awaiting completed outcomes. Prediction count is not performance evidence.</p> : <>
        <h3>Direction and return estimates</h3>
        <p className={styles.tableNote}>Lower forecast errors are better. Daily net diagnostics include {MODEL_FORWARD.roundTripCostBps[cohort.market]}bp round-trip costs when active; always-up is a daily session strategy, not buy-and-hold. Current-engine arms are prepublication reconstructions of its numeric policy, not an audit of email receipt or news overrides.</p>
        <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label={`${cohort.market} directional comparisons`}><table style={tableStyle}><thead><tr>{['Model', 'Return MSE', 'Up probability Brier', 'MSE vs past average', 'Active decisions', 'Net / session', 'Net vs cash, 95% interval', 'Net at double costs'].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead><tbody>{cohort.models.map(m => <tr key={m.name}><th style={cell}>{names[m.name] ?? m.name}</th><td style={cell}>{number(m.mse)}</td><td style={cell}>{number(m.brier)}</td><td style={cell}>{number(m.mseMinusBase)}</td><td style={cell}>{m.active}</td><td style={cell}>{number(m.meanNetPct)}%</td><td style={cell}>{interval(m.netVsCash95)}</td><td style={cell}>{number(m.meanNetDoubleCostPct)}%</td></tr>)}</tbody></table></div>
        <h3>Move-size and volatility estimates</h3>
        <p className={styles.tableNote}>Negative QLIKE difference beats the constant-risk baseline. QLIKE penalizes forecasts that underestimate large moves. Absolute-move estimates use an approximate normal conversion; they are not price bounds.</p>
        <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label={`${cohort.market} risk comparisons`}><table style={tableStyle}><thead><tr>{['Risk model', 'Absolute-move error', 'QLIKE vs constant', 'Paired 95% block interval'].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead><tbody>{cohort.risk?.map(r => <tr key={r.name}><th style={cell}>{names[r.name] ?? r.name}</th><td style={cell}>{number(r.absoluteMoveMae)} percentage points</td><td style={cell}>{number(r.qlikeDifference)}</td><td style={cell}>{interval(r.paired95)}</td></tr>)}</tbody></table></div>
      </>}
    </section>)}
    <p className={styles.tableNote}>Only timestamp-eligible stored forecasts count. Missing quotes, incomplete reads and unfinished sessions are unavailable. Algorithm hashes are evaluated separately, so changing a model cannot rewrite its track record. Small samples and historical improvements do not establish a live edge.</p>
  </div></main>;
}
