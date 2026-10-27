import { createHash } from 'node:crypto';
import { MODEL_FORWARD } from './recipe';
import type { ForwardPrediction } from './models';
import type { Price } from './features';
import { stockSessionOpen } from '../signal/publication-timing';
import { isCompletedPriceDate, latestCompletedPriceDate } from '../market-data/completed-price-bars';
// JSONB reorders object keys; integrity checks must survive that round trip.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString().slice(0, 10) === value;
export type SavedPrediction = { experiment: string; modelHash: string; recipeHash: string; capturedAt: string; sourceRevision: string | null; deploymentId: string | null; inputHash: string; prediction: ForwardPrediction; checksum: string; traffic_type: 'internal' };
export type SavedOutcome = { experiment: string; predictionId: string; modelHash: string; targetDate: string; actualReturn: number; quote: Price; settledAt: string; traffic_type: 'internal' };
export type ModelEvent = { id: string; event_name: string; created_at: string; metadata: Record<string, unknown> };
export function validSavedPrediction(row: ModelEvent): SavedPrediction | null {
  if (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) return null;
  const m = row.metadata as unknown as SavedPrediction, p = m.prediction;
  if (row.event_name !== MODEL_FORWARD.predictionEvent || m.experiment !== MODEL_FORWARD.id || m.traffic_type !== 'internal' || !p || !['stocks', 'crypto'].includes(p.market) ||
    !Number.isFinite(Date.parse(m.capturedAt)) || !Number.isFinite(Date.parse(p.targetOpen)) || !Number.isFinite(Date.parse(row.created_at)) ||
    !validDate(p.sourceDate) || !validDate(p.targetDate) ||
    Date.parse(m.capturedAt) >= Date.parse(p.targetOpen) || Date.parse(row.created_at) >= Date.parse(p.targetOpen) || p.sourceDate >= p.targetDate ||
    p.maxTrainingTargetDate >= p.sourceDate || !Number.isFinite(p.referencePrice) || p.referencePrice <= 0 ||
    !p.arms || !p.risk || !Number.isFinite(p.risk.ewma) || !Number.isFinite(p.risk.constant) ||
    !['cash', 'always_up', 'trailing_mean', 'aligned_ridge', 'aligned_shrunk_analog'].every(k => p.arms[k]) ||
    !p.fit || p.fit.maxTargetDate >= p.fit.date || p.fit.date > p.sourceDate ||
    Object.values(p.risk).some(v => !Number.isFinite(v) || v <= 0) ||
    Object.values(p.arms).some(a => ![-1, 0, 1].includes(a.position) || !Number.isFinite(a.score) ||
      (a.expectedReturn !== null && !Number.isFinite(a.expectedReturn)) || (a.probabilityUp !== null && (!Number.isFinite(a.probabilityUp) || a.probabilityUp < 0 || a.probabilityUp > 1)))) return null;
  const ticker = p.market === 'stocks' ? 'SPY' : 'BTC-USD';
  if (latestCompletedPriceDate(ticker, new Date(m.capturedAt)) !== p.sourceDate) return null;
  const open = p.market === 'stocks' ? stockSessionOpen(p.targetDate) : Date.parse(`${p.targetDate}T00:00:00Z`);
  if (open === null || open !== Date.parse(p.targetOpen) || (p.market === 'stocks' && !isCompletedPriceDate('SPY', p.targetDate, new Date(`${p.targetDate}T23:59:00Z`)))) return null;
  if (p.market === 'crypto' && Date.parse(p.targetDate) - Date.parse(p.sourceDate) !== 2 * 86400000) return null;
  const { checksum, ...payload } = m;
  return checksum === digest(payload) ? m : null;
}
export function validSavedOutcome(row: ModelEvent, prediction: SavedPrediction): SavedOutcome | null {
  if (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) return null;
  const o = row.metadata as unknown as SavedOutcome, p = prediction.prediction;
  if (row.event_name !== MODEL_FORWARD.outcomeEvent || o.experiment !== MODEL_FORWARD.id || o.traffic_type !== 'internal' ||
    o.modelHash !== prediction.modelHash || o.targetDate !== p.targetDate || o.quote?.trade_date !== p.targetDate ||
    !Number.isFinite(o.quote.open) || !Number.isFinite(o.quote.close) || o.quote.open <= 0 || o.quote.close <= 0 ||
    !Number.isFinite(o.actualReturn) || Math.abs(o.actualReturn - (o.quote.close / o.quote.open - 1) * 100) > 1e-9 ||
    !Number.isFinite(Date.parse(o.settledAt)) || !Number.isFinite(Date.parse(row.created_at))) return null;
  const ticker = p.market === 'stocks' ? 'SPY' : 'BTC-USD';
  return isCompletedPriceDate(ticker, p.targetDate, new Date(o.settledAt)) && isCompletedPriceDate(ticker, p.targetDate, new Date(row.created_at)) ? o : null;
}
