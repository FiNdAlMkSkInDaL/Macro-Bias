import 'server-only';
import { createHash } from 'node:crypto';
import { createSupabaseAdminClient } from '../supabase/admin';
import { completedPriceDateCutoff, isCompletedPriceDate } from '../market-data/completed-price-bars';
import { computeForwardPrediction, ModelForwardError, type ForwardPrediction } from './models';
import { tickers, type Prices, type Price } from './features';
import { MODEL_FORWARD, type ModelMarket } from './recipe';
import { FORWARD_MODEL_HASH } from './fingerprint';
import { digest, validSavedPrediction, validSavedOutcome, type SavedPrediction, type SavedOutcome, type ModelEvent } from './records';
export { validSavedPrediction, type ModelEvent } from './records';
import { average, blockInterval, netReturn } from './math';

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export type ForwardDeps = { admin: Admin; clock: () => Date; readPrices: (now: Date) => Promise<Prices> };
export const recipeHash = digest(MODEL_FORWARD);
export function modelEventId(key: string) {
  const h = createHash('sha256').update(`${MODEL_FORWARD.id}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function loadForwardPrices(admin: Admin, now: Date): Promise<Prices> {
  return Object.fromEntries(await Promise.all(tickers.map(async ticker => {
    const rows: Price[] = [], cutoff = completedPriceDateCutoff(ticker.endsWith('-USD') ? 'BTC-USD' : 'SPY', now);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('etf_daily_prices').select('trade_date,open,close').eq('ticker', ticker).lte('trade_date', cutoff).order('trade_date').range(from, from + 999);
      if (error) throw new ModelForwardError('price_read_unavailable');
      rows.push(...data ?? []); if (!data || data.length < 1000) break;
    }
    if (rows.length < 500 || rows.some((p, i) => !Number.isFinite(p.open) || !Number.isFinite(p.close) || p.open <= 0 || p.close <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.trade_date) || p.trade_date > cutoff ||
      ((ticker === 'SPY' || ticker === 'BTC-USD') && !isCompletedPriceDate(ticker, p.trade_date, now)) ||
      (i > 0 && p.trade_date <= rows[i - 1].trade_date))) throw new ModelForwardError('price_history_invalid');
    return [ticker, rows];
  }))) as Prices;
}
export function forwardDependencies(): ForwardDeps {
  const admin = createSupabaseAdminClient({ timeoutMs: 15_000 });
  return { admin, clock: () => new Date(), readPrices: now => loadForwardPrices(admin, now) };
}
export async function readModelEvents(admin: Admin): Promise<ModelEvent[]> {
  const rows: ModelEvent[] = [];
  for (let from = 0; ; from += 100) {
    const { data, error } = await admin.from('marketing_event_log').select('id,event_name,created_at,metadata')
      .in('event_name', [MODEL_FORWARD.predictionEvent, MODEL_FORWARD.outcomeEvent, MODEL_FORWARD.healthEvent])
      .eq('metadata->>experiment', MODEL_FORWARD.id).gte('created_at', MODEL_FORWARD.start).order('created_at').order('id').range(from, from + 99);
    if (error) throw new ModelForwardError('forward_history_unavailable');
    rows.push(...data ?? []); if (!data || data.length < 100) break;
  }
  return rows;
}
export async function recordForwardFailure() {
  const now = new Date();
  if (now.toISOString() < MODEL_FORWARD.start || now.toISOString() >= MODEL_FORWARD.settlementEnd) return;
  await insertImmutable(createSupabaseAdminClient({ timeoutMs: 8_000 }), modelEventId(`failure:${now.toISOString()}`), MODEL_FORWARD.healthEvent,
    { experiment: MODEL_FORWARD.id, modelHash: FORWARD_MODEL_HASH, traffic_type: 'internal', checkedAt: now.toISOString(), ok: false,
      results: [{ status: 'blocked', reason: 'forward_collection_unavailable' }] });
}
async function insertImmutable(admin: Admin, id: string, event: string, metadata: unknown) {
  const { data, error } = await admin.from('marketing_event_log').insert({ id, event_name: event, page_path: '/api/cron/model-forward', metadata }).select('id,event_name,created_at,metadata').single();
  if (!error) return { status: 'saved', row: data as ModelEvent };
  if (error.code !== '23505') throw new ModelForwardError('forward_write_unavailable');
  const existing = await admin.from('marketing_event_log').select('id,event_name,created_at,metadata').eq('id', id).single();
  if (existing.error || !existing.data) throw new ModelForwardError('forward_duplicate_read_unavailable');
  return { status: 'already_saved', row: existing.data as ModelEvent };
}
export async function runModelForward({ preview = false, deps = forwardDependencies() }: { preview?: boolean; deps?: ForwardDeps } = {}) {
  const started = deps.clock();
  if (started.toISOString() < MODEL_FORWARD.start || started.toISOString() >= MODEL_FORWARD.settlementEnd) return { ok: true, mode: 'inactive', results: [] };
  const [prices, history] = await Promise.all([deps.readPrices(started), readModelEvents(deps.admin)]);
  const results: { market?: ModelMarket; targetDate?: string; status: string; reason?: string }[] = [];
  const outcomes = new Map(history.filter(r => r.event_name === MODEL_FORWARD.outcomeEvent).map(r => [String(r.metadata.predictionId), r]));
  for (const row of history.filter(r => r.event_name === MODEL_FORWARD.predictionEvent)) {
    const saved = validSavedPrediction(row);
    if (!saved) { results.push({ status: 'invalid_prediction', reason: 'ineligible_or_changed_prediction' }); continue; }
    if (outcomes.has(row.id)) {
      if (!validSavedOutcome(outcomes.get(row.id)!, saved)) results.push({ market: saved.prediction.market, targetDate: saved.prediction.targetDate, status: 'blocked', reason: 'stored_outcome_ineligible' });
      continue;
    }
    const p = saved.prediction, ticker = p.market === 'stocks' ? 'SPY' : 'BTC-USD';
    if (!isCompletedPriceDate(ticker, p.targetDate, started)) continue;
    const quote = prices[ticker].find(r => r.trade_date === p.targetDate);
    if (!quote) { results.push({ market: p.market, targetDate: p.targetDate, status: 'blocked', reason: 'completed_outcome_quote_missing' }); continue; }
    const outcome: SavedOutcome = { experiment: MODEL_FORWARD.id, predictionId: row.id, modelHash: saved.modelHash, targetDate: p.targetDate,
      actualReturn: (quote.close / quote.open - 1) * 100, quote, settledAt: deps.clock().toISOString(), traffic_type: 'internal' };
    if (!preview) await insertImmutable(deps.admin, modelEventId(`outcome:${row.id}`), MODEL_FORWARD.outcomeEvent, outcome);
    results.push({ market: p.market, targetDate: p.targetDate, status: preview ? 'would_settle' : 'settled' });
  }
  if (started.toISOString() < MODEL_FORWARD.captureEnd) {
    for (const market of ['stocks', 'crypto'] as const) {
      try {
        const fit = history.slice().reverse().map(validSavedPrediction).find(p => p?.modelHash === FORWARD_MODEL_HASH && p.prediction.market === market)?.prediction.fit;
        const prediction = computeForwardPrediction(prices, market, started, fit);
        const id = modelEventId(`prediction:${market}:${prediction.targetDate}`);
        const existing = history.find(r => r.id === id);
        if (existing) {
          if (!validSavedPrediction(existing)) throw new ModelForwardError('saved_prediction_ineligible');
          results.push({ market, targetDate: prediction.targetDate, status: 'already_saved' }); continue;
        }
        const capturedAt = deps.clock().toISOString();
        if (capturedAt >= prediction.targetOpen || prediction.targetOpen >= MODEL_FORWARD.captureEnd) {
          results.push({ market, targetDate: prediction.targetDate, status: 'skipped', reason: 'target_already_open_or_outside_window' }); continue;
        }
        const payload = { experiment: MODEL_FORWARD.id, modelHash: FORWARD_MODEL_HASH, recipeHash, capturedAt,
          sourceRevision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || process.env.MODEL_SOURCE_REVISION?.trim() || null,
          deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null, inputHash: digest(prices), prediction, traffic_type: 'internal' as const };
        if (!preview) {
          const result = await insertImmutable(deps.admin, id, MODEL_FORWARD.predictionEvent, { ...payload, checksum: digest(payload) });
          // Database time is authoritative if a slow write crosses the target open.
          if (!validSavedPrediction(result.row)) throw new ModelForwardError('database_capture_missed_target_open');
          results.push({ market, targetDate: prediction.targetDate, status: result.status });
        } else results.push({ market, targetDate: prediction.targetDate, status: 'would_capture' });
      } catch (error) { results.push({ market, status: 'blocked', reason: error instanceof ModelForwardError ? error.code : 'model_computation_unavailable' }); }
    }
  }
  const ok = !results.some(r => ['blocked', 'invalid_prediction'].includes(r.status));
  if (!preview) await insertImmutable(deps.admin, modelEventId(`health:${started.toISOString()}`), MODEL_FORWARD.healthEvent,
    { experiment: MODEL_FORWARD.id, modelHash: FORWARD_MODEL_HASH, traffic_type: 'internal', checkedAt: deps.clock().toISOString(), ok, results });
  return { ok, mode: preview ? 'preview' : 'live', results };
}
export function summarizeForward(events: ModelEvent[]) {
  const predictions = events.filter(r => r.event_name === MODEL_FORWARD.predictionEvent);
  const outcomes = new Map(events.filter(r => r.event_name === MODEL_FORWARD.outcomeEvent).map(r => [String(r.metadata.predictionId), r]));
  const cohorts = new Map<string, { saved: SavedPrediction; outcome: SavedOutcome | null }[]>();
  let invalid = 0;
  for (const row of predictions) {
    const saved = validSavedPrediction(row); if (!saved) { invalid++; continue; }
    const outcomeRow = outcomes.get(row.id), outcome = outcomeRow ? validSavedOutcome(outcomeRow, saved) : null;
    if (outcomeRow && !outcome) { invalid++; continue; }
    const key = `${saved.prediction.market}:${saved.modelHash}:${saved.recipeHash}`;
    cohorts.set(key, [...cohorts.get(key) ?? [], { saved, outcome: outcome ?? null }]);
  }
  return { experiment: MODEL_FORWARD, capturedAt: new Date().toISOString(), invalid, cohorts: [...cohorts.entries()].map(([key, rows]) => {
    const completed = rows.filter((r): r is { saved: SavedPrediction; outcome: SavedOutcome } => r.outcome !== null), market = rows[0].saved.prediction.market;
    const cost = MODEL_FORWARD.roundTripCostBps[market] / 100;
    const models = completed.length ? Object.keys(completed[0].saved.prediction.arms).map(name => {
      const paired = completed.map(r => { const arm = r.saved.prediction.arms[name], base = r.saved.prediction.arms.trailing_mean;
        return { y: r.outcome.actualReturn, arm, base, net: netReturn(r.outcome.actualReturn, arm.position, cost) }; });
      const mse = paired.every(r => r.arm.expectedReturn !== null) ? average(paired.map(r => (r.y - r.arm.expectedReturn!) ** 2)) : null;
      const brier = paired.every(r => r.arm.probabilityUp !== null) ? average(paired.map(r => (Number(r.y > 0) - r.arm.probabilityUp!) ** 2)) : null;
      return { name, mse, brier, active: paired.filter(r => r.arm.position !== 0).length, meanNetPct: average(paired.map(r => r.net)),
        netVsCash95: blockInterval(paired.map(r => r.net)), meanNetDoubleCostPct: average(paired.map(r => netReturn(r.y, r.arm.position, cost * 2))),
        mseMinusBase: mse === null ? null : average(paired.map(r => (r.y - r.arm.expectedReturn!) ** 2 - (r.y - r.base.expectedReturn!) ** 2)),
        brierMinusBase: brier === null ? null : average(paired.map(r => (Number(r.y > 0) - r.arm.probabilityUp!) ** 2 - (Number(r.y > 0) - r.base.probabilityUp!) ** 2)) };
    }) : null;
    const risk = completed.length ? Object.keys(completed[0].saved.prediction.risk).map(name => {
      const loss = (v: number, y: number) => Math.log(v) + y * y / v;
      const differences = completed.map(r => loss(r.saved.prediction.risk[name], r.outcome.actualReturn) - loss(r.saved.prediction.risk.constant, r.outcome.actualReturn));
      return { name, qlikeDifference: average(differences), paired95: blockInterval(differences),
        absoluteMoveMae: average(completed.map(r => Math.abs(Math.abs(r.outcome.actualReturn) - Math.sqrt(r.saved.prediction.risk[name] * 2 / Math.PI)))) };
    }) : null;
    return { key, market, modelHash: rows[0].saved.modelHash, locked: rows.length, completed: completed.length, pending: rows.length - completed.length,
      reviewReady: completed.length >= MODEL_FORWARD.minimumCompletedPerMarket, models, risk };
  }), latestHealth: events.filter(r => r.event_name === MODEL_FORWARD.healthEvent).at(-1)?.metadata ?? null };
}
