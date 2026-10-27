/** Pure private monitoring policy. No provider access, publisher imports or writes. */
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const day = 86400000;
function interval(xs, policy) {
  if (xs.length < policy.minimumCompleted || xs.some(x => !Number.isFinite(x))) return null;
  let seed = policy.bootstrapSeed >>> 0;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const means = [];
  for (let i = 0; i < policy.bootstrapReplications; i++) {
    let total = 0, count = 0;
    while (count < xs.length) {
      const start = Math.floor(random() * (xs.length - policy.bootstrapBlock + 1));
      for (let j = 0; j < policy.bootstrapBlock && count < xs.length; j++, count++) total += xs[start + j];
    }
    means.push(total / count);
  }
  means.sort((a, b) => a - b);
  const tail = policy.familywiseAlphaPerReview / policy.primaryComparisons / 2;
  return [means[Math.floor(tail * means.length)], means[Math.min(means.length - 1, Math.floor((1 - tail) * means.length))]];
}
function comparison(primary, secondary, policy) {
  const finite = primary.length >= policy.minimumCompleted && primary.every(Number.isFinite) && secondary.every(Number.isFinite);
  const paired = finite ? interval(primary, policy) : null;
  const recent = policy.recentBlock;
  const checks = finite ? {
    overall: mean(primary) < 0,
    lastBlock: mean(primary.slice(-recent)) < 0,
    previousBlock: mean(primary.slice(-2 * recent, -recent)) < 0,
    adjustedInterval: paired !== null && paired[1] < 0,
    secondaryOverall: mean(secondary) <= 0,
    secondaryRecent: mean(secondary.slice(-2 * recent)) <= 0,
  } : {};
  return { eligible: finite, passes: finite && Object.values(checks).every(Boolean),
    primaryMeanDifference: finite ? mean(primary) : null, adjustedPairedInterval: paired, checks };
}
function evaluateCohort(rows, policy) {
  if (!rows.length) return [];
  const market = rows[0].saved.prediction.market;
  const squared = (p, y) => (p - y) ** 2;
  const qlike = (v, y) => Math.log(v) + y * y / v;
  const absLoss = (v, y) => Math.abs(Math.abs(y) - Math.sqrt(v * 2 / Math.PI));
  const choices = [];
  for (const candidate of policy.directionalCandidates) {
    const comparisons = policy.directionalBaselines.map(baseline => {
      const primary = [], secondary = [];
      for (const row of rows) {
        const y = row.outcome.actualReturn, arms = row.saved.prediction.arms, c = arms[candidate], b = arms[baseline];
        if (!c || !b || c.expectedReturn === null || b.expectedReturn === null || c.probabilityUp === null || b.probabilityUp === null) {
          primary.push(NaN); secondary.push(NaN); continue;
        }
        primary.push(squared(c.expectedReturn, y) - squared(b.expectedReturn, y));
        secondary.push(squared(c.probabilityUp, Number(y > 0)) - squared(b.probabilityUp, Number(y > 0)));
      }
      return { baseline, ...comparison(primary, secondary, policy) };
    });
    choices.push({ candidate, kind: 'directional_return_forecast', comparisons, passes: comparisons.every(c => c.passes) });
  }
  const candidate = policy.riskCandidates[market];
  const comparisons = policy.riskBaselines[market].map(baseline => {
    const primary = [], secondary = [];
    for (const row of rows) {
      const y = row.outcome.actualReturn, risk = row.saved.prediction.risk, c = risk[candidate], b = risk[baseline];
      primary.push(c > 0 && b > 0 ? qlike(c, y) - qlike(b, y) : NaN);
      secondary.push(c > 0 && b > 0 ? absLoss(c, y) - absLoss(b, y) : NaN);
    }
    return { baseline, ...comparison(primary, secondary, policy) };
  });
  choices.push({ candidate, kind: 'move_size_forecast', comparisons, passes: comparisons.every(c => c.passes) });
  return choices;
}
function healthIssues({ now, summary, predictions, completed, expectedTargets, policy, experiment }) {
  const issues = [];
  if (now.toISOString() >= experiment.settlementEnd) return issues;
  const health = summary.latestHealth, checked = Date.parse(health?.checkedAt ?? '');
  if (!Number.isFinite(checked) || checked > now.getTime() + 60000 || now.getTime() - checked > policy.maximumHealthAgeHours * 3600000)
    issues.push('collector_health_missing_or_stale');
  if (health?.ok === false) issues.push('collector_reported_failure');
  if (summary.invalid > 0) issues.push('invalid_or_changed_test_records');
  if (now.getUTCHours() + now.getUTCMinutes() / 60 >= policy.captureGraceHourUtc && now.toISOString() < experiment.captureEnd) {
    for (const [market, targetDate] of Object.entries(expectedTargets)) {
      if (targetDate >= experiment.captureEnd.slice(0, 10) || (market === 'stocks' && targetDate === '2026-10-27')) continue;
      if (!predictions.some(r => r.prediction.market === market && r.prediction.targetDate === targetDate)) issues.push(`${market}_scheduled_prediction_missing`);
    }
  }
  for (const row of predictions) {
    if (completed.some(r => r.id === row.id)) continue;
    const end = Date.parse(row.prediction.targetOpen) + (row.prediction.market === 'stocks' ? 6.5 : 24) * 3600000;
    if (now.getTime() - end > policy.outcomeGraceHours * 3600000) issues.push(`${row.prediction.market}_outcome_settlement_overdue`);
  }
  return [...new Set(issues)];
}
function advanceState(report, previous, policy) {
  const next = JSON.parse(JSON.stringify(previous ?? { version: policy.version, issues: [], reviews: {}, notified: [], lastComplete: null }));
  if (next.version !== policy.version) throw Error('Monitor policy changed; explicit state migration required');
  const notifications = [];
  const newIssues = report.issues.filter(issue => !next.issues.includes(issue));
  const resolved = next.issues.filter(issue => !report.issues.includes(issue));
  if (newIssues.length) notifications.push({ type: 'failure', issues: newIssues });
  if (resolved.length) notifications.push({ type: 'recovery', issues: resolved });
  next.issues = report.issues;
  const now = new Date(report.checkedAt), week = now.toISOString().slice(0, 10);
  if (now.getUTCDay() === policy.weeklyReviewDayUtc && report.issues.length === 0) {
    for (const cohort of report.cohorts) for (const choice of cohort.candidates) {
      const key = `${cohort.key}:${choice.candidate}`, prior = next.reviews[key];
      if (prior?.date === week) continue;
      const elapsedDays = prior ? (now.getTime() - Date.parse(prior.date)) / day : Infinity;
      const confirmed = choice.passes && prior?.passes && elapsedDays >= policy.confirmAfterDays && elapsedDays <= policy.confirmAfterDays + 1 && cohort.completed > prior.completed;
      if (confirmed && !next.notified.includes(key)) {
        notifications.push({ type: 'sustained_early_evidence', market: cohort.market, candidate: choice.candidate, kind: choice.kind, completed: cohort.completed, comparisons: choice.comparisons,
          caveat: 'Repeated weekly checks are not independent validation or evidence of trading profitability. No promotion.' });
        next.notified.push(key);
      }
      next.reviews[key] = { date: week, passes: choice.passes, completed: cohort.completed };
    }
  }
  if (now.toISOString() >= report.settlementEnd && !next.finalReported) {
    notifications.push({ type: 'final_review', cohorts: report.cohorts }); next.finalReported = true;
  }
  next.lastComplete = report;
  return { state: next, notifications };
}
function unavailableState(previous, policy, checkedAt) {
  const state = JSON.parse(JSON.stringify(previous ?? { version: policy.version, issues: [], reviews: {}, notified: [], lastComplete: null }));
  const issue = 'monitor_read_or_configuration_unavailable';
  const notifications = state.issues.includes(issue) ? [] : [{ type: 'failure', issues: [issue] }];
  state.issues = [...new Set([...state.issues, issue])]; state.lastAttempt = checkedAt;
  return { state, notifications };
}
module.exports = { interval, comparison, evaluateCohort, healthIssues, advanceState, unavailableState };
