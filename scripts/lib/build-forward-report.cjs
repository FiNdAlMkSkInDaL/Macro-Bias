/** Shared aggregate projection. Inputs may contain private vectors; output never does. */
const { evaluateCohort, healthIssues } = require('./forward-monitor.cjs');
function buildForwardReport({ now, events, summarizeForward, validSavedPrediction, validSavedOutcome, isCompletedPriceDate, experiment, policy }) {
  const summary = summarizeForward(events);
  const predictions = events.flatMap(row => { const saved = validSavedPrediction(row); return saved ? [{ id: row.id, ...saved }] : []; });
  const outcomes = new Map(events.filter(r => r.event_name === experiment.outcomeEvent).map(r => [String(r.metadata.predictionId), r]));
  const completed = predictions.flatMap(({ id, ...saved }) => {
    const row = outcomes.get(id), outcome = row ? validSavedOutcome(row, saved) : null;
    return outcome ? [{ id, saved, outcome }] : [];
  });
  let stockTarget = now.toISOString().slice(0, 10);
  for (let count = 0; !isCompletedPriceDate('SPY', stockTarget, new Date(stockTarget + 'T23:59:00Z')); count++) {
    if (count >= 10) throw Error('Exchange calendar unavailable');
    stockTarget = new Date(Date.parse(stockTarget) + 86400000).toISOString().slice(0, 10);
  }
  const expectedTargets = { stocks: stockTarget, crypto: new Date(now.getTime() + 86400000).toISOString().slice(0, 10) };
  const issues = healthIssues({ now, summary, predictions, completed, expectedTargets, policy, experiment });
  return { version: policy.version, experiment: experiment.id, checkedAt: now.toISOString(), completeRead: true, settlementEnd: experiment.settlementEnd,
    issues, invalidRecords: summary.invalid, latestHealthAt: summary.latestHealth?.checkedAt ?? null,
    cohorts: summary.cohorts.map(cohort => {
      const rows = completed.filter(r => `${r.saved.prediction.market}:${r.saved.modelHash}:${r.saved.recipeHash}` === cohort.key)
        .sort((a, b) => a.saved.prediction.targetDate.localeCompare(b.saved.prediction.targetDate));
      return { key: cohort.key, market: cohort.market, locked: cohort.locked, completed: cohort.completed, pending: cohort.pending,
        candidates: evaluateCohort(rows, policy) };
    }) };
}
module.exports = { buildForwardReport };
