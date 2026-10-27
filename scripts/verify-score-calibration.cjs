const assert = require('node:assert/strict');
const math = require('./distribution-loader.cjs')()('src/lib/model-forward/math');
const { calibrateScore } = require('./lib/private-score-calibration.cjs');
const recipe = require('../docs/score-calibration-recipe-20261027.json');
const date = i => new Date(Date.parse('2020-01-01') + i * 86400000).toISOString().slice(0, 10);
const rows = Array.from({ length: 800 }, (_, i) => ({ date: date(i), targetDate: date(i + 2), score: 50 * Math.sin(i / 7), outcome: Math.sin(i / 7) * 0.2 + Math.cos(i / 3), volatility20: 1 }));
const early = calibrateScore(rows.slice(0, 600), recipe, math), full = calibrateScore(rows, recipe, math);
assert(early.length > 200);
assert.deepEqual(early, full.filter(r => r.date <= rows[599].date));
const poisoned = rows.map((r, i) => i > 599 ? { ...r, outcome: 1000000, score: -100 } : r);
assert.deepEqual(early, calibrateScore(poisoned, recipe, math).filter(r => r.date <= rows[599].date));
for (const r of full) {
  assert(r.maxTrainingTargetDate < r.fitSourceDate && r.fitSourceDate <= r.date);
  assert(r.trainingRows >= recipe.minimumTrainingRows);
  assert(r.candidate.probabilityUp >= 0 && r.candidate.probabilityUp <= 1);
}
assert.equal(calibrateScore(rows.slice(0, 253), recipe, math).length, 0);
const horizon = 599;
const tomorrowPoison = rows.map(r => r.targetDate >= rows[horizon].date ? { ...r, outcome: 999999 } : r);
assert.deepEqual(calibrateScore(tomorrowPoison.slice(0, 600), recipe, math).at(-1).candidate, early.at(-1).candidate);
console.log('PASS: chronological replay, future poisoning, unmatured labels, monthly fit embargo, minimum sample and bounded probabilities. No production access.');
