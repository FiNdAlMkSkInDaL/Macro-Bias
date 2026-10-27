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
const { advanceState, unavailableState } = require('./lib/forward-monitor.cjs');
const { buildForwardReport } = require('./lib/build-forward-report.cjs');
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
  const events = await readModelEvents(admin);
  const report = buildForwardReport({ now, events, summarizeForward, validSavedPrediction, validSavedOutcome, isCompletedPriceDate,
    experiment: MODEL_FORWARD, policy });
  if (frozenFilesChanged()) report.issues.push('subscriber_or_production_model_code_changed_since_freeze');
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
