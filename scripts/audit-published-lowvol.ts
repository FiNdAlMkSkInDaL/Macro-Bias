/** Read-only check using the original stored v18 matches, not rebuilt history.
 * npx tsx scripts/audit-published-lowvol.ts <output.json> [completed-cutoff-YYYY-MM-DD] */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { ANALOG_MODEL_SETTINGS as settings, STRATEGY_RULES } from '../src/lib/macro-bias/constants';
import { applyFadeBigDay, applySoftOvernightAmp, applyOvernightVeto, neighborReturnDispersion } from '../src/lib/macro-bias/calculate-daily-bias';
import { buildTradableSignal, positionFromSignal, weightedMean } from '../src/lib/signal';
import { isUsEquityMonday } from '../src/utils/knn';
const cutoff = process.argv[3] ?? '2026-10-21';
if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff) || !Number.isFinite(Date.parse(`${cutoff}T00:00:00Z`))) throw Error('Supply cutoff as YYYY-MM-DD');
async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const r = await db.from('macro_bias_scores').select('trade_date,score,created_at,component:component_scores->0,spy:ticker_changes->SPY,signal:engine_inputs->tradableSignal,window:engine_inputs->tradeWindow')
    .eq('model_version', 'macro-model-v18-adaptive-k').lte('trade_date', cutoff).order('trade_date');
  const prices = await db.from('etf_daily_prices').select('trade_date,open,close').eq('ticker', 'SPY').lte('trade_date', cutoff).gte('trade_date', '2026-01-01').order('trade_date');
  if (r.error || prices.error) throw Error('Published score/price read failed');
  const rows: Record<string, unknown>[] = [], excluded: Record<string, unknown>[] = [];
  for (const item of r.data ?? []) {
    const row = item as unknown as { trade_date: string; score: number; created_at: string; component: { analogMatches: { tradeDate: string; weight: number; distance: number; spyForward1DayReturn: number; spyForward3DayReturn: number }[] }; spy: { open: number; previousClose: number; percentChange: number }; signal: Parameters<typeof positionFromSignal>[0]; window: { latestTradeDate: string } };
    const outcome = prices.data?.find(p => p.trade_date === row.trade_date);
    const sourceDate = row.window?.latestTradeDate;
    const matches = row.component?.analogMatches;
    const noon = new Date(`${row.trade_date}T17:00:00Z`);
    const nyHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(noon));
    const openTime = Date.parse(`${row.trade_date}T00:00:00Z`) + (9.5 + 17 - nyHour) * 3_600_000;
    if (!outcome || !sourceDate || sourceDate >= row.trade_date || !matches?.length || matches.some(m => !Number.isFinite(m.weight) || !Number.isFinite(m.distance)) || Date.parse(row.created_at) > openTime) {
      excluded.push({ date: row.trade_date, reason: 'Missing original inputs/outcome or score published after session open' }); continue;
    }
    const w = matches.map(m => m.weight);
    const blended = matches.map(m => m.spyForward1DayReturn * settings.oneDayBlendWeight + m.spyForward3DayReturn * settings.threeDayBlendWeight);
    const raw = Math.round(Math.tanh(Number((weightedMean(matches.map(m => m.spyForward1DayReturn), w) * settings.oneDayBlendWeight + weightedMean(matches.map(m => m.spyForward3DayReturn), w) * settings.threeDayBlendWeight).toFixed(2)) / settings.blendedReturnScale) * 100);
    const dispersion = neighborReturnDispersion(blended);
    const gap = row.spy.open > 0 && row.spy.previousClose > 0 ? (row.spy.open / row.spy.previousClose - 1) * 100 : null;
    const decision = (filter: boolean) => {
      let score = filter && dispersion < settings.flatLowNeighborVolThreshold ? 0 : raw;
      score = applyFadeBigDay(score, row.spy.percentChange); score = applySoftOvernightAmp(score, gap); score = applyOvernightVeto(score, gap);
      const signal = buildTradableSignal({ score, neighborForwardReturns: blended, neighborDistances: matches.map(m => m.distance), rules: STRATEGY_RULES });
      if (settings.skipMondayScores && isUsEquityMonday(sourceDate)) { score = 0; if (signal.position !== 'NO_TRADE') signal.position = 'FLAT'; }
      return { score, position: positionFromSignal(signal, score, STRATEGY_RULES) };
    };
    const on = decision(true), off = decision(false);
    const actualPosition = positionFromSignal(row.signal, row.score, STRATEGY_RULES);
    if (on.score !== row.score || on.position !== actualPosition) { excluded.push({ date: row.trade_date, reason: 'Rounded original-match replay differs from stored decision', storedScore: row.score, replayScore: on.score }); continue; }
    rows.push({ date: row.trade_date, sourceDate, publishedAt: row.created_at, rawScore: raw, dispersion, on, off, outcomePct: (outcome.close / outcome.open - 1) * 100 });
  }
  const changed = rows.filter(row => (row.on as { position: string }).position !== (row.off as { position: string }).position);
  const report = { generatedAt: new Date().toISOString(), cutoff, scope: 'Original stored v18 matched sets, publications before target session open, completed same-session SPY open-to-close outcomes only.',
    limitations: 'Small live sample; rounded stored matches; excludes mismatches and backfilled/late rows. Not evidence of a validated long-run edge.',
    compared: rows.length, changedDecisions: changed.length, excluded, rows };
  if (!process.argv[2]) throw Error('Supply output JSON path outside repository');
  writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ compared: rows.length, changedDecisions: changed.length, excluded, recent: rows.slice(-4) }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Published audit unavailable'); process.exitCode = 1; });
