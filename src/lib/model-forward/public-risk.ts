import 'server-only';
import { createSupabaseAdminClient } from '../supabase/admin';
import { stockSessionOpen } from '../signal/publication-timing';
import { MODEL_FORWARD } from './recipe';
import { validSavedPrediction, type ModelEvent } from './records';
import type { StockRiskState } from './risk';

/** Only estimates locked before the target open can reach customer surfaces. */
export async function loadPublicStockRisk(targetDate?: string, now = new Date()): Promise<StockRiskState> {
  try {
    const { data, error } = await createSupabaseAdminClient({ timeoutMs: 8_000 }).from('marketing_event_log')
      .select('id,event_name,created_at,metadata').eq('event_name', MODEL_FORWARD.predictionEvent)
      .eq('metadata->>experiment', MODEL_FORWARD.id).eq('metadata->prediction->>market', 'stocks')
      .order('created_at', { ascending: false }).limit(8);
    if (error) throw Error('unavailable');
    for (const row of data ?? []) {
      const saved = validSavedPrediction(row as ModelEvent); if (!saved) continue;
      const p = saved.prediction, open = stockSessionOpen(p.targetDate);
      if (open === null || Date.parse(saved.capturedAt) > now.getTime() || (targetDate && p.targetDate !== targetDate)) continue;
      // No silently stale forecast after the session's conservative finality buffer.
      if (now.getTime() >= open + 6.75 * 3_600_000) continue;
      if (p.targetDate < now.toISOString().slice(0, 10)) continue;
      return { forecast: { sourceDate: p.sourceDate, targetDate: p.targetDate, capturedAt: saved.capturedAt,
        absoluteMovePct: Math.sqrt(p.risk.ewma * 2 / Math.PI), referencePrice: p.referencePrice, version: 'stock-risk-ewma-094-v1' }, notice: null };
    }
    return { forecast: null, notice: 'The next session’s SPY move estimate is not available yet.' };
  } catch { return { forecast: null, notice: 'The SPY move estimate is temporarily unavailable.' }; }
}
