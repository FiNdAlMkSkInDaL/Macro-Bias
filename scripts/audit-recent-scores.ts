/** Read-only recent score audit; original rounded matches, never writes model rows.
 * npx tsx scripts/audit-recent-scores.ts <private-output.json> [YYYY-MM-DD] */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { ANALOG_MODEL_SETTINGS as stocks } from '../src/lib/macro-bias/constants';
import { CRYPTO_ANALOG_MODEL_SETTINGS as crypto, CRYPTO_MODEL_VERSION } from '../src/lib/crypto-bias/constants';
import { applyLowNeighborVolFlat, applyFadeBigDay, applySoftOvernightAmp, applyOvernightVeto, neighborReturnDispersion } from '../src/lib/macro-bias/calculate-daily-bias';
import { weightedMean } from '../src/lib/signal';
import { isUsEquityMonday } from '../src/utils/knn';

type Match = { weight: number; spyForward1DayReturn?: number; spyForward3DayReturn?: number; btcForward1DayReturn?: number; btcForward3DayReturn?: number };
type Row = { trade_date: string; score: number; bias_label: string; created_at: string; model: string | null;
  component: { analogMatches?: Match[] } | null; signal: { reason?: string; position?: string; scoreContext?: { rawScore?: number; suppressedBy?: string[] } } | null;
  window?: { latestTradeDate?: string } | null; spy?: { open: number; previousClose: number; percentChange: number } | null };
async function main() {
  const output = process.argv[2], cutoff = process.argv[3] ?? new Date().toISOString().slice(0, 10);
  if (!output || !/^\d{4}-\d{2}-\d{2}$/.test(cutoff) || !Number.isFinite(Date.parse(`${cutoff}T00:00:00Z`))) throw Error('Supply output path and valid date');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const markets = await Promise.all((['stocks', 'crypto'] as const).map(async market => {
    const columns = 'trade_date,score,bias_label,created_at,component:component_scores->0,signal:engine_inputs->tradableSignal,' +
      (market === 'stocks' ? 'model:model_version,window:engine_inputs->tradeWindow,spy:ticker_changes->SPY' : 'model:engine_inputs->>modelVersion');
    const { data, error } = await db.from(market === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores')
      .select(columns).lte('trade_date', cutoff).order('trade_date', { ascending: false }).limit(60);
    if (error) throw Error(`${market} score read unavailable`);
    const rows = (data as unknown as Row[]).map(row => {
      const matches = row.component?.analogMatches ?? [], settings = market === 'stocks' ? stocks : crypto;
      const f1 = matches.map(m => market === 'stocks' ? m.spyForward1DayReturn : m.btcForward1DayReturn);
      const f3 = matches.map(m => market === 'stocks' ? m.spyForward3DayReturn : m.btcForward3DayReturn);
      const weights = matches.map(m => m.weight);
      const valid = matches.length > 1 && [...weights, ...f1, ...f3].every(n => typeof n === 'number' && Number.isFinite(n));
      const sourceDate = market === 'stocks' ? row.window?.latestTradeDate ?? null : row.trade_date;
      let replay: number | null = null, raw: number | null = null, dispersion: number | null = null;
      const reasons: string[] = [];
      const supported = row.model === (market === 'stocks' ? 'macro-model-v18-adaptive-k' : CRYPTO_MODEL_VERSION);
      if (valid && supported) {
        const blended = f1.map((n, i) => n! * settings.oneDayBlendWeight + f3[i]! * settings.threeDayBlendWeight);
        const expectancy = Number((weightedMean(f1 as number[], weights) * settings.oneDayBlendWeight + weightedMean(f3 as number[], weights) * settings.threeDayBlendWeight).toFixed(2));
        raw = Math.round(Math.tanh(expectancy / settings.blendedReturnScale) * 100);
        replay = raw;
        dispersion = neighborReturnDispersion(blended);
        if (market === 'stocks') {
          if (stocks.flatLowNeighborVolEnabled && dispersion < stocks.flatLowNeighborVolThreshold) reasons.push('low_variation');
          replay = applyLowNeighborVolFlat(replay, blended);
          if (!row.spy || !sourceDate) replay = null;
          else {
            const gap = row.spy.open > 0 && row.spy.previousClose > 0 ? (row.spy.open / row.spy.previousClose - 1) * 100 : null;
            replay = applyFadeBigDay(replay, row.spy.percentChange);
            replay = applySoftOvernightAmp(replay, gap);
            const before = replay; replay = applyOvernightVeto(replay, gap);
            if (before !== 0 && replay === 0) reasons.push('overnight_conflict');
            if (stocks.skipMondayScores && isUsEquityMonday(sourceDate)) { reasons.push('monday_source_bar'); replay = 0; }
          }
        }
        if (raw === 0) reasons.push('raw_estimate_rounds_to_zero');
      }
      return { date: row.trade_date, sourceDate, score: row.score, label: row.bias_label, publishedAt: row.created_at,
        model: row.model, originalMatches: matches.length, rawReplay: raw, savedRaw: row.signal?.scoreContext?.rawScore ?? null,
        dispersion, replay, replayMatches: replay === null ? null : replay === row.score,
        reasons, savedReasons: row.signal?.scoreContext?.suppressedBy ?? null, permission: row.signal?.position ?? null, storedReason: row.signal?.reason ?? null };
    });
    const windows = [10, 20, 30, 60].map(n => { const sample = rows.slice(0, n); return { requestedReadings: n, readings: sample.length,
      first: sample.at(-1)?.date, last: sample[0]?.date, zeros: sample.filter(r => r.score === 0).length,
      neutralLabels: sample.filter(r => r.label === 'NEUTRAL').length }; });
    return { market, windows, replayCompared: rows.filter(r => r.replay !== null).length,
      replayMismatches: rows.filter(r => r.replayMatches === false), recent: rows.slice(0, 20) };
  }));
  const report = { capturedAt: new Date().toISOString(), cutoff, limitations: 'Rounded original stored matched sets, current version only. This verifies score arithmetic and suppression, not historical neighbor selection, full data-feed correctness or predictive value. Stock source bars precede publication sessions; crypto bars are dated UTC. No model or publication writes.', markets };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error('Score audit unavailable; do not substitute zeros.'); process.exitCode = 1; });
