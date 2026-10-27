import assert from 'node:assert/strict';
import { alignedTargetIndex, analogForecast, average, blockInterval, ewmaVariance, fitRidge, matureTraining, netReturn, predictRidge, tradingPosition, type ResearchRow } from './lib/scoring-research';
import { classifyRegime, resolveThresholds } from '../src/utils/regime-classifier';

const day = (i: number) => new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
const rows: ResearchRow[] = Array.from({ length: 400 }, (_, i) => ({ date: day(i), targetDate: day(i + 2), features: [Math.sin(i / 10), Math.cos(i / 20)],
  momentum20: 0, momentum60: 0, volatility20: 1, outcome: Math.sin(i / 10) * 2 + 0.2 }));

assert.equal(alignedTargetIndex('stocks', ['2026-10-23', '2026-10-26', '2026-10-27'], 0), 1, 'Friday source targets next SPY session');
assert.equal(alignedTargetIndex('crypto', ['2026-10-24', '2026-10-25', '2026-10-26'], 0), 2, 'Next-day noon publication cannot enter the elapsed UTC bar');
assert.equal(alignedTargetIndex('crypto', ['2026-10-24', '2026-10-26', '2026-10-27'], 0), null, 'Missing UTC target cannot shift silently');
assert.equal(alignedTargetIndex('stocks', ['2026-10-26'], 0), null, 'Unfinished targets excluded');
const today = rows[300];
const train = matureTraining(rows, today.date, 1095);
assert.equal(train.at(-1)!.targetDate, day(299));
assert(train.every(r => r.targetDate < today.date));
const poisoned = rows.map(r => r.targetDate >= today.date ? { ...r, outcome: 1e9, features: [1e12, -1e12] } : r);
const poisonedTrain = matureTraining(poisoned, today.date, 1095);
assert.deepEqual(poisonedTrain, train, 'Future and unmatured outcomes/features cannot affect training');
const small = matureTraining(rows.slice(0, 301), today.date, 1095);
assert.deepEqual(small, train, 'Appending future rows cannot change a past fit');
const model = fitRidge(train, train.map(r => r.outcome), 1);
assert.deepEqual(model, fitRidge(poisonedTrain, poisonedTrain.map(r => r.outcome), 1));
assert.deepEqual(analogForecast(train, today), analogForecast(poisonedTrain, today));
const exact = fitRidge(train, train.map(r => r.outcome), 1e-8);
assert(Math.abs(predictRidge(exact, [0.5, 0]) - 1.2) < 1e-5, 'Solver recovers known relationship');
const intercept = fitRidge(train, train.map(() => 3), 1);
assert(Math.abs(predictRidge(intercept, [1e8, -1e8]) - 3) < 1e-8, 'Intercept is not shrunk; extreme features remain bounded');
assert.throws(() => fitRidge(train, train.map(() => NaN), 1));
assert.throws(() => predictRidge(model, [NaN, 0]));
const constant = train.map(r => ({ ...r, outcome: 1, volatility20: 1 }));
assert.equal(analogForecast(constant, today).expectedReturn, 1, 'Shrinkage preserves constant targets');
assert(Math.abs(ewmaVariance(constant) - 1) < 1e-12);
assert(Math.abs(netReturn(1, 1, 0.1) - 0.9) < 1e-12);
assert(Math.abs(netReturn(1, -1, 0.1) + 1.1) < 1e-12, 'Short losses and costs use correct signs');
assert.equal(netReturn(-100, 0, 0.3), 0, 'Cash pays no fictitious trade cost');
assert.equal(tradingPosition(0.1, 0.1), 0, 'Expected return equal to cost is not an edge');
assert.equal(tradingPosition(-0.4, 0.3), -1);
assert.deepEqual(blockInterval(Array(100).fill(-0.5)), [-0.5, -0.5]);
assert.equal(blockInterval([1, 2]), null, 'Insufficient data is unavailable');
assert.deepEqual(blockInterval(rows.map(r => r.outcome)), blockInterval(rows.map(r => r.outcome)), 'Fixed seed reproduces evidence');
assert(Math.abs(average(train.map(r => predictRidge(model, r.features))) - average(train.map(r => r.outcome))) < 1e-8, 'Unpenalized intercept fits training mean');
for (const count of [20, 30, 80]) {
  for (const constant of [false, true]) {
    const history = Array.from({ length: count }, (_, i) => ({ vector: { hygTltRatio: constant ? 50 : (i * 7) % 100, vixLevel: constant ? 50 : (i * 13) % 100 } }));
    const thresholds = resolveThresholds({ calibrationDataset: history });
    const oldPool = history.filter(r => classifyRegime(r, { calibrationDataset: history }) === classifyRegime(history[0], { calibrationDataset: history }));
    const newPool = history.filter(r => classifyRegime(r, { thresholds }) === classifyRegime(history[0], { thresholds }));
    assert.deepEqual(newPool, oldPool, 'Cached thresholds must preserve every member of the production matching pool');
  }
}
console.log('Scoring research: timing, embargo, future poisoning, append invariance, numerical fit, costs, uncertainty and missing-data checks passed.');
