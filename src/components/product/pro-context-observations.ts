import 'server-only';

import type { ProductAsset } from '@/lib/product/score-access';

export type ProContextObservation = { key: string; label: string; text: string };
type ContextSnapshot = { engine_inputs: unknown; technical_indicators: unknown };

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function bounded(value: unknown) {
  const result = number(value);
  return result != null && result >= 0 && result <= 100 ? result : null;
}

/** Display only recorded input conditions, using the existing producers' meanings.
 * These descriptions do not alter or attribute contributions to the model score.
 */
export function buildProContextObservations(asset: ProductAsset, snapshot: ContextSnapshot | null): ProContextObservation[] {
  if (!snapshot) return [];
  const engine = record(snapshot.engine_inputs);
  if (asset === 'stocks') {
    const momentum = bounded(record(record(snapshot.technical_indicators).SPY).rsi14);
    const volatility = number(record(engine.marketPlumbing).vixMomentum);
    const oil = number(record(record(engine.supplementalTickerChanges).USO).percentChange);
    if (momentum == null && volatility == null && oil == null) return [];
    return [
      { key: 'momentum', label: 'Momentum', text: momentum == null ? 'Recorded stock momentum is unavailable.'
        : momentum >= 60 ? 'Recent stock price momentum is strong.' : momentum <= 40 ? 'Recent stock price momentum is soft.' : 'Recent stock price momentum is mixed.' },
      // The stock producer stores negative VIX five-session % change. Its
      // published summary explicitly maps negative to rising, positive to cooling.
      // Do not read the ambiguous legacy gammaExposure alias as this input.
      { key: 'volatility', label: 'Volatility', text: volatility == null ? 'Recorded volatility context is unavailable.'
        : volatility < 0 ? 'Market volatility has been rising.' : volatility > 0 ? 'Market volatility has been easing.' : 'Market volatility has been steady.' },
      { key: 'oil', label: 'Oil', text: oil == null ? 'Recorded oil price context is unavailable.'
        : oil < 0 ? 'Oil fell in the recorded session.' : oil > 0 ? 'Oil rose in the recorded session.' : 'Oil was unchanged in the recorded session.' },
    ];
  }
  const momentum = bounded(engine.btc14DayRsi);
  // Only the explicitly named historical rank has these existing 75/45 bands;
  // the raw annualized btcRealizedVol field is a different unit and is not used.
  const volatility = bounded(engine.btcRealizedVolPercentile);
  const dollar = number(engine.dxyMomentum);
  if (momentum == null && volatility == null && dollar == null) return [];
  return [
    { key: 'momentum', label: 'Bitcoin momentum', text: momentum == null ? 'Recorded Bitcoin momentum is unavailable.'
      : momentum >= 60 ? 'Recent Bitcoin price momentum is strong.' : momentum <= 40 ? 'Recent Bitcoin price momentum is soft.' : 'Recent Bitcoin price momentum is mixed.' },
    { key: 'volatility', label: 'Price swings', text: volatility == null ? 'Recorded Bitcoin price-swing context is unavailable.'
      : volatility >= 75 ? 'Recent Bitcoin price swings are large compared with its history.' : volatility >= 45 ? 'Recent Bitcoin price swings are moderate compared with its history.' : 'Recent Bitcoin price swings are small compared with its history.' },
    { key: 'dollar', label: 'US dollar', text: dollar == null ? 'Recorded US dollar context is unavailable.'
      : dollar > 0 ? 'The US dollar strengthened over the five recorded sessions.' : dollar < 0 ? 'The US dollar weakened over the five recorded sessions.' : 'The US dollar was steady over the five recorded sessions.' },
  ];
}
