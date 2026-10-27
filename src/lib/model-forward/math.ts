/** Frozen publication-aligned model math. No provider access or side effects. */
export type ResearchRow = {
  date: string;
  targetDate: string;
  features: number[];
  momentum20: number;
  momentum60: number;
  volatility20: number;
  outcome: number;
};
export type Forecast = { expectedReturn: number; probabilityUp: number };
export type FittedRidge = { mean: number[]; sd: number[]; coefficients: number[]; intercept: number; clip: number };
export const average = (a: readonly number[]) => {
  if (!a.length || a.some(x => !Number.isFinite(x))) throw Error('Expected nonempty finite observations');
  return a.reduce((s, x) => s + x, 0) / a.length;
};
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const round = (n: number, digits = 6) => Number(n.toFixed(digits));
export function alignedTargetIndex(market: 'stocks' | 'crypto', dates: readonly string[], sourceIndex: number): number | null {
  if (sourceIndex < 0 || sourceIndex >= dates.length) throw Error('Invalid source index');
  const index = sourceIndex + (market === 'stocks' ? 1 : 2);
  if (index >= dates.length) return null;
  if (market === 'crypto' && Date.parse(dates[index]) - Date.parse(dates[sourceIndex]) !== 2 * 86400000) return null;
  return index;
}
export function matureTraining(rows: readonly ResearchRow[], sourceDate: string, calendarDays: number) {
  const lower = new Date(Date.parse(sourceDate) - calendarDays * 86400000).toISOString().slice(0, 10);
  return rows.filter(r => r.date >= lower && r.date < sourceDate && r.targetDate < sourceDate && Number.isFinite(r.outcome));
}
export function fitScale(rows: readonly ResearchRow[]) {
  const dimensions = rows[0]?.features.length;
  if (!dimensions || rows.some(r => r.features.length !== dimensions || r.features.some(x => !Number.isFinite(x)))) throw Error('Invalid training features');
  const mean = Array.from({ length: dimensions }, (_, j) => average(rows.map(r => r.features[j])));
  const sd = mean.map((m, j) => Math.sqrt(average(rows.map(r => (r.features[j] - m) ** 2))) || 1);
  return { mean, sd };
}
const scaled = (features: number[], scale: { mean: number[]; sd: number[] }, clip: number) => {
  if (features.length !== scale.mean.length || features.some(x => !Number.isFinite(x))) throw Error('Invalid prediction features');
  return features.map((x, j) => clamp((x - scale.mean[j]) / scale.sd[j], -clip, clip));
};
/** Pivoted dense solve. Positive ridge penalty keeps the small normal system nonsingular. */
function solve(matrix: number[][], vector: number[]) {
  const a = matrix.map((row, i) => [...row, vector[i]]), n = a.length;
  for (let j = 0; j < n; j++) {
    let pivot = j;
    for (let i = j + 1; i < n; i++) if (Math.abs(a[i][j]) > Math.abs(a[pivot][j])) pivot = i;
    [a[j], a[pivot]] = [a[pivot], a[j]];
    if (Math.abs(a[j][j]) < 1e-12) throw Error('Singular regression');
    const divisor = a[j][j];
    for (let k = j; k <= n; k++) a[j][k] /= divisor;
    for (let i = 0; i < n; i++) if (i !== j) {
      const factor = a[i][j];
      for (let k = j; k <= n; k++) a[i][k] -= factor * a[j][k];
    }
  }
  return a.map(row => row[n]);
}
/** Intercept is unpenalized. Penalty multiplies mean squared loss, not summed loss. */
export function fitRidge(rows: readonly ResearchRow[], targets: number[], penalty: number, clip = 4): FittedRidge {
  if (!(penalty > 0) || targets.length !== rows.length) throw Error('Invalid ridge fit');
  const scale = fitScale(rows), n = rows.length, p = scale.mean.length + 1;
  const a = Array.from({ length: p }, () => Array(p).fill(0) as number[]), b = Array(p).fill(0) as number[];
  rows.forEach((row, i) => {
    if (!Number.isFinite(targets[i])) throw Error('Invalid target');
    const x = [1, ...scaled(row.features, scale, clip)];
    for (let j = 0; j < p; j++) { b[j] += x[j] * targets[i] / n; for (let k = 0; k < p; k++) a[j][k] += x[j] * x[k] / n; }
  });
  for (let j = 1; j < p; j++) a[j][j] += penalty;
  const beta = solve(a, b);
  return { ...scale, intercept: beta[0], coefficients: beta.slice(1), clip };
}
export function predictRidge(model: FittedRidge, features: number[]) {
  return model.intercept + scaled(features, model, model.clip).reduce((s, x, j) => s + x * model.coefficients[j], 0);
}
export function analogForecast(train: readonly ResearchRow[], today: ResearchRow, k = 40, priorWeight = 0.5, clip = 4): Forecast {
  if (train.length < k || priorWeight < 0 || priorWeight > 1) throw Error('Invalid analogue training');
  const scale = fitScale(train), current = scaled(today.features, scale, clip);
  const neighbors = train.map(row => ({ row, distance: scaled(row.features, scale, clip).reduce((s, x, j) => s + (x - current[j]) ** 2, 0) }))
    .sort((a, b) => a.distance - b.distance || a.row.date.localeCompare(b.row.date)).slice(0, k).map(x => x.row);
  // Volatility-normalized return targets keep a handful of extreme historical days from dominating.
  const local = average(neighbors.map(r => r.outcome / Math.max(r.volatility20, 0.01))) * today.volatility20;
  return { expectedReturn: priorWeight * average(train.map(r => r.outcome)) + (1 - priorWeight) * local,
    probabilityUp: priorWeight * average(train.map(r => Number(r.outcome > 0))) + (1 - priorWeight) * average(neighbors.map(r => Number(r.outcome > 0))) };
}
export function ewmaVariance(rows: readonly ResearchRow[], decay = 0.94) {
  let variance = average(rows.map(r => r.outcome ** 2));
  for (const row of rows) variance = decay * variance + (1 - decay) * row.outcome ** 2;
  return Math.max(variance, 1e-8);
}
export const tradingPosition = (prediction: number, roundTripCostPct: number) => prediction > roundTripCostPct ? 1 : prediction < -roundTripCostPct ? -1 : 0;
export function netReturn(outcome: number, position: number, costPct: number) {
  if (![outcome, position, costPct].every(Number.isFinite) || Math.abs(position) > 1 || costPct < 0) throw Error('Invalid trading diagnostic');
  return position === 0 ? 0 : position * outcome - Math.abs(position) * costPct;
}
export function correlation(a: number[], b: number[]) {
  if (a.length !== b.length || a.length < 2) return null;
  const ma = average(a), mb = average(b);
  const denominator = Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0));
  return denominator ? round(a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / denominator) : null;
}
/** Paired moving-block bootstrap; keeps sessions within each block in original order. */
export function blockInterval(differences: number[], block = 20, repetitions = 1000, seed = 27102026) {
  if (differences.length < block * 2) return null;
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  const means: number[] = [];
  for (let b = 0; b < repetitions; b++) {
    let sum = 0, n = 0;
    while (n < differences.length) {
      const start = Math.floor(random() * (differences.length - block + 1));
      for (let j = 0; j < block && n < differences.length; j++, n++) sum += differences[start + j];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return [round(means[Math.floor(repetitions * 0.025)]), round(means[Math.min(repetitions - 1, Math.floor(repetitions * 0.975))])];
}
