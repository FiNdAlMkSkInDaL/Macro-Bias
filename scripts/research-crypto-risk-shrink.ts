/** Fixed 50/50 candidate, declared in MODEL_FORWARD before examining this result. */
import { readFileSync, writeFileSync } from 'node:fs';
import { average, blockInterval, round } from '../src/lib/model-forward/math';
import { MODEL_FORWARD } from '../src/lib/model-forward/recipe';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Supply prior crypto-evaluations.json and aggregate output path');
type Row = { targetDate: string; outcome: number; riskConstant: number; riskEwma: number };
const rows: Row[] = JSON.parse(readFileSync(input, 'utf8'));
function stats(group: Row[]) {
  const loss = (v: number, y: number) => Math.log(v) + y * y / v;
  const predict = (r: Row) => MODEL_FORWARD.cryptoVariancePriorWeight * r.riskConstant + (1 - MODEL_FORWARD.cryptoVariancePriorWeight) * r.riskEwma;
  const delta = group.map(r => loss(predict(r), r.outcome) - loss(r.riskConstant, r.outcome));
  return { sessions: group.length, constantQlike: round(average(group.map(r => loss(r.riskConstant, r.outcome)))),
    ewmaQlike: round(average(group.map(r => loss(r.riskEwma, r.outcome)))), shrinkQlike: round(average(group.map(r => loss(predict(r), r.outcome)))),
    shrinkMinusConstantQlike: round(average(delta)), paired95: blockInterval(delta),
    shrinkAbsoluteMoveMae: round(average(group.map(r => Math.abs(Math.abs(r.outcome) - Math.sqrt(predict(r) * 2 / Math.PI))))),
    constantAbsoluteMoveMae: round(average(group.map(r => Math.abs(Math.abs(r.outcome) - Math.sqrt(r.riskConstant * 2 / Math.PI))))) };
}
const report = { generatedAt: new Date().toISOString(), candidate: 'crypto-risk-shrink-50-v1', priorWeight: MODEL_FORWARD.cryptoVariancePriorWeight,
  status: 'SHADOW_ONLY_NO_PRODUCTION_PROMOTION', limitations: ['Fixed 50/50 blend, no weight search. Reused historical data, not an untouched holdout.', 'Normal absolute-move conversion is an approximation. Future tail-risk performance remains unproven.'],
  overall: stats(rows), reviewed2026: stats(rows.filter(r => r.targetDate >= '2026-01-01')),
  annual: [...new Set(rows.map(r => r.targetDate.slice(0, 4)))].map(year => ({ year, ...stats(rows.filter(r => r.targetDate.startsWith(year))) })) };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
