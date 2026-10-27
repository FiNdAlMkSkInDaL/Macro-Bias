import { MODEL_FORWARD, type ModelMarket } from './recipe';
import { makeRows, production, type Prices } from './features';
import { analogForecast, average, clamp, ewmaVariance, fitRidge, matureTraining, predictRidge, tradingPosition, type FittedRidge } from './math';
import { latestCompletedPriceDate } from '../market-data/completed-price-bars';
import { stockSessionOpen } from '../signal/publication-timing';

export type PredictionArm = { score: number; position: number; expectedReturn: number | null; probabilityUp: number | null };
export type MonthlyFit = { date: string; trainingRows: number; maxTargetDate: string; returns: FittedRidge; probability: FittedRidge };
export type ForwardPrediction = {
  market: ModelMarket;
  sourceDate: string;
  targetDate: string;
  targetOpen: string;
  referencePrice: number;
  features: number[];
  trainingRows: number;
  maxTrainingTargetDate: string;
  fit: MonthlyFit;
  arms: Record<string, PredictionArm>;
  risk: Record<string, number>;
};
export class ModelForwardError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function computeForwardPrediction(prices: Prices, market: ModelMarket, now = new Date(), previousFit?: MonthlyFit): ForwardPrediction {
  const { rows } = makeRows(prices, market), today = rows.at(-1);
  const expectedSource = latestCompletedPriceDate(market === 'stocks' ? 'SPY' : 'BTC-USD', now);
  if (!today || today.date !== expectedSource) throw new ModelForwardError(`${market}_fresh_inputs_unavailable`);
  const train = matureTraining(rows, today.date, MODEL_FORWARD.trainingCalendarDays);
  if (train.length < MODEL_FORWARD.minimumTrainingRows) throw new ModelForwardError(`${market}_insufficient_training`);
  const firstThisMonth = rows.find(r => r.date.startsWith(today.date.slice(0, 7)))!;
  let fit = previousFit?.date === firstThisMonth.date ? previousFit : undefined;
  if (!fit) {
    const fitTrain = matureTraining(rows, firstThisMonth.date, MODEL_FORWARD.trainingCalendarDays);
    if (fitTrain.length < MODEL_FORWARD.minimumTrainingRows) throw new ModelForwardError(`${market}_insufficient_monthly_training`);
    fit = { date: firstThisMonth.date, trainingRows: fitTrain.length, maxTargetDate: fitTrain.at(-1)!.targetDate,
      returns: fitRidge(fitTrain, fitTrain.map(r => r.outcome / Math.max(r.volatility20, 0.01)), MODEL_FORWARD.ridgePenaltyMeanLoss, MODEL_FORWARD.featureClip),
      probability: fitRidge(fitTrain, fitTrain.map(r => Number(r.outcome > 0)), MODEL_FORWARD.ridgePenaltyMeanLoss, MODEL_FORWARD.featureClip) };
  }
  if (fit.maxTargetDate >= fit.date || fit.date > today.date || train.at(-1)!.targetDate >= today.date) throw new ModelForwardError('training_embargo_failed');
  const cost = MODEL_FORWARD.roundTripCostBps[market] / 100;
  const expected = (value: { expectedReturn: number; probabilityUp: number }): PredictionArm => ({ ...value, score: value.expectedReturn, position: tradingPosition(value.expectedReturn, cost) });
  const original = production(today, rows, market);
  const constantVariance = average(train.map(r => r.outcome ** 2)), ewma = ewmaVariance(train, MODEL_FORWARD.varianceDecay);
  const targetOpen = market === 'stocks' ? stockSessionOpen(today.targetDate) : Date.parse(`${today.targetDate}T00:00:00Z`);
  if (targetOpen === null || !Number.isFinite(targetOpen)) throw new ModelForwardError('target_session_unavailable');
  return { market, sourceDate: today.date, targetDate: today.targetDate, targetOpen: new Date(targetOpen).toISOString(), referencePrice: today.close,
    features: today.features, trainingRows: train.length, maxTrainingTargetDate: train.at(-1)!.targetDate, fit,
    arms: {
      cash: { score: 0, position: 0, expectedReturn: 0, probabilityUp: 0.5 },
      always_up: { score: 1, position: 1, expectedReturn: null, probabilityUp: 1 },
      trailing_mean: expected({ expectedReturn: average(train.map(r => r.outcome)), probabilityUp: average(train.map(r => Number(r.outcome > 0))) }),
      momentum_20: { score: today.momentum20, position: Math.sign(today.momentum20), expectedReturn: null, probabilityUp: null },
      momentum_60: { score: today.momentum60, position: Math.sign(today.momentum60), expectedReturn: null, probabilityUp: null },
      production_raw: { score: original.score, position: Math.abs(original.score) > 20 ? Math.sign(original.score) : 0, expectedReturn: null, probabilityUp: null },
      production_filtered: { score: original.score, position: original.position, expectedReturn: null, probabilityUp: null },
      aligned_shrunk_analog: expected(analogForecast(train, today, MODEL_FORWARD.neighbors, MODEL_FORWARD.analoguePriorWeight, MODEL_FORWARD.featureClip)),
      aligned_ridge: expected({ expectedReturn: predictRidge(fit.returns, today.features) * today.volatility20,
        probabilityUp: clamp(predictRidge(fit.probability, today.features), 0.01, 0.99) }),
    }, risk: { constant: constantVariance, ewma,
      ...(market === 'crypto' ? { shrink_50: MODEL_FORWARD.cryptoVariancePriorWeight * constantVariance + (1 - MODEL_FORWARD.cryptoVariancePriorWeight) * ewma } : {}) } };
}
