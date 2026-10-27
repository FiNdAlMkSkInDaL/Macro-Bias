/** Read-only production monitor. --record updates aggregate local state only. */
require('@next/env').loadEnvConfig(process.cwd());
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'docs/model-monitor-policy.json'), 'utf8'));
const statePath = path.join(root, 'docs/model-forward-monitor-state.json');
const record = process.argv.includes('--record');
const previous = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
const { evaluateCohort, healthIssues, advanceState, unavailableState } = require('./lib/forward-monitor.cjs');
const overrides = {}, load = require('./distribution-loader.cjs')(overrides);
overrides['../signal'] = load('src/lib/signal/strategy');
const { readModelEvents, summarizeForward } = load('src/lib/model-forward/service');
const { validSavedPrediction, validSavedOutcome } = load('src/lib/model-forward/records');
const { MODEL_FORWARD } = load('src/lib/model-forward/recipe');
const { isCompletedPriceDate } = load('src/lib/market-data/completed-price-bars');
function save(state) {
  if (!record) return;
  const temp = statePath + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n'); fs.renameSync(temp, statePath);
}
function frozenFilesChanged() {
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'docs/subscriber-model-freeze.json'), 'utf8'));
  return frozen.files.some(({ file, sha256 }) => {
    const current = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
    return createHash('sha256').update(current).digest('hex') !== sha256;
  });
}
async function main() {
  const now = new Date(), admin = load('src/lib/supabase/admin').createSupabaseAdminClient({ timeoutMs: 15000 });
  const events = await readModelEvents(admin), summary = summarizeForward(events);
  const predictions = events.flatMap(row => { const saved = validSavedPrediction(row); return saved ? [{ id: row.id, ...saved }] : []; });
  const outcomes = new Map(events.filter(r => r.event_name === MODEL_FORWARD.outcomeEvent).map(r => [String(r.metadata.predictionId), r]));
  const completed = predictions.flatMap(({ id, ...saved }) => {
    const row = outcomes.get(id), outcome = row ? validSavedOutcome(row, saved) : null;
    return outcome ? [{ id, saved, outcome }] : [];
  });
  let stockTarget = now.toISOString().slice(0, 10);
  while (!isCompletedPriceDate('SPY', stockTarget, new Date(stockTarget + 'T23:59:00Z')))
    stockTarget = new Date(Date.parse(stockTarget) + 86400000).toISOString().slice(0, 10);
  const expectedTargets = { stocks: stockTarget, crypto: new Date(now.getTime() + 86400000).toISOString().slice(0, 10) };
  const issues = healthIssues({ now, summary, predictions, completed, expectedTargets, policy, experiment: MODEL_FORWARD });
  if (frozenFilesChanged()) issues.push('subscriber_or_production_model_code_changed_since_freeze');
  const report = { version: policy.version, checkedAt: now.toISOString(), completeRead: true, settlementEnd: MODEL_FORWARD.settlementEnd,
    issues, invalidRecords: summary.invalid, latestHealthAt: summary.latestHealth?.checkedAt ?? null,
    cohorts: summary.cohorts.map(cohort => {
      const rows = completed.filter(r => `${r.saved.prediction.market}:${r.saved.modelHash}:${r.saved.recipeHash}` === cohort.key)
        .sort((a, b) => a.saved.prediction.targetDate.localeCompare(b.saved.prediction.targetDate));
      return { key: cohort.key, market: cohort.market, locked: cohort.locked, completed: cohort.completed, pending: cohort.pending,
        candidates: evaluateCohort(rows, policy) };
    }) };
  const result = advanceState(report, previous, policy); save(result.state);
  console.log(JSON.stringify({ report, notifications: result.notifications, localStateRecorded: record }, null, 2));
}
main().catch(() => {
  const { state, notifications } = unavailableState(previous, policy, new Date().toISOString());
  save(state);
  console.log(JSON.stringify({ completeRead: false, status: 'unavailable', lastCompletePreserved: state.lastComplete !== null,
    notifications, localStateRecorded: record }));
  process.exitCode = 1;
});
