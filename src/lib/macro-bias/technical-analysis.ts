function roundTo(value: number, decimals = 4) {
  return Number(value.toFixed(decimals));
}

// A plain SMA over the most recent `period` closes.
export function calculateSimpleMovingAverage(closes: number[], period: number) {
  if (closes.length < period) {
    throw new Error(`Need at least ${period} closes to calculate SMA.`);
  }

  const window = closes.slice(-period);
  const total = window.reduce((sum, close) => sum + close, 0);

  return roundTo(total / period, 4);
}

// Wilder RSI using smoothed average gains and losses after the initial seed window.
export function calculateRelativeStrengthIndex(closes: number[], period: number) {
  if (closes.length < period + 1) {
    throw new Error(`Need at least ${period + 1} closes to calculate RSI.`);
  }

  let averageGain = 0;
  let averageLoss = 0;

  for (let index = 1; index <= period; index += 1) {
    const delta = closes[index] - closes[index - 1];
    averageGain += Math.max(delta, 0);
    averageLoss += Math.max(-delta, 0);
  }

  averageGain /= period;
  averageLoss /= period;

  for (let index = period + 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }

  if (averageLoss === 0) {
    return 100;
  }

  if (averageGain === 0) {
    return 0;
  }

  const relativeStrength = averageGain / averageLoss;

  return roundTo(100 - 100 / (1 + relativeStrength), 2);
}