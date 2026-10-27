/** Public projection only. No model weights, training data or private predictions. */
export type StockRiskForecast = {
  sourceDate: string;
  targetDate: string;
  capturedAt: string;
  absoluteMovePct: number;
  referencePrice: number;
  version: string;
};
export type StockRiskState = { forecast: StockRiskForecast | null; notice: string | null };
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${date}T00:00:00Z`));
export function stockRiskCopy(forecast: StockRiskForecast) {
  return {
    title: `SPY move estimate · ${dateLabel(forecast.targetDate)}`,
    estimate: `Around ${forecast.absoluteMovePct.toFixed(2)}% from open to close`,
    detail: `That is about $${(forecast.absoluteMovePct / 100 * forecast.referencePrice).toFixed(2)} per share using the ${dateLabel(forecast.sourceDate)} close as a reference.`,
    scope: 'This estimates the size of the move in either direction. It excludes overnight gaps and the full high-to-low range; actual moves can be larger.',
    evidence: 'The estimate adapts to recent completed sessions. Live forward testing is underway.',
  };
}
export function stockRiskText(state?: StockRiskState | null) {
  if (!state?.forecast) return state?.notice ? `SPY move estimate\n${state.notice}` : '';
  const copy = stockRiskCopy(state.forecast);
  return [copy.title, copy.estimate, copy.detail, copy.scope, copy.evidence].join('\n');
}
