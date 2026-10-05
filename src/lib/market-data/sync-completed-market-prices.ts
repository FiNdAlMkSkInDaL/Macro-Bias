import { createSupabaseAdminClient } from '../supabase/admin';
import { fetchCompletedYahooPrices, latestCompletedPriceDate, type CompletedPriceRow } from './completed-price-bars';

const PRICE_COLUMNS = 'ticker,trade_date,open,high,low,close,adjusted_close,volume,source,created_at';
const SYNC_BUDGET_MS = 140_000;

function storedBeforeCryptoClose(stored: Record<string, unknown>, row: CompletedPriceRow) {
  // Legacy ingestion inserted that day's forming crypto quote. Creation before
  // its UTC close proves it was not a confirmed completed candle when stored.
  const created = typeof stored.created_at === 'string' ? Date.parse(stored.created_at) : NaN;
  const opened = Date.parse(`${row.trade_date}T00:00:00Z`);
  return row.ticker.endsWith('-USD') && stored.source === 'yahoo-chart-api'
    && Number.isFinite(created) && created >= opened && created < opened + 86_400_000;
}

function pricesMatch(stored: Record<string, unknown>, row: CompletedPriceRow) {
  return (['open', 'high', 'low', 'close', 'adjusted_close', 'volume'] as const).every((key) => Number(stored[key]) === row[key]) && stored.source === row.source;
}

/** Price-only ingestion. Does not import or execute models, publishers, or delivery. */
export async function syncCompletedMarketPrices(now = new Date()) {
  const supabase = createSupabaseAdminClient({ timeoutMs: 5_000 });
  const deadlineAt = Date.now() + SYNC_BUDGET_MS;
  const querySignal = () => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new Error('Completed-price sync time budget exceeded.');
    return AbortSignal.timeout(Math.min(5_000, remaining));
  };
  const results = [];
  // Sequential requests avoid adding bursts to Yahoo's cloud-IP rate limits.
  for (const ticker of ['SPY', 'BTC-USD', 'ETH-USD', 'SOL-USD'] as const) {
    try {
      const sourceRows = await fetchCompletedYahooPrices(ticker, now, { deadlineAt });
      const row = sourceRows.at(-1);
      if (!row) throw new Error(`No completed daily price returned for ${ticker}.`);
      const existing = await supabase.from('etf_daily_prices').select(PRICE_COLUMNS)
        .eq('ticker', ticker).gte('trade_date', sourceRows[0].trade_date).lte('trade_date', row.trade_date).abortSignal(querySignal());
      if (existing.error) throw existing.error;
      const stored = new Map((existing.data ?? []).map((value) => [value.trade_date as string, value]));
      const missing = sourceRows.filter((value) => !stored.has(value.trade_date));
      const writes: Array<{ tradeDate: string; operation: 'insert' | 'update' }> = [];
      if (missing.length) {
        // DO NOTHING on conflict preserves a concurrently inserted historical row.
        const inserted = await supabase.from('etf_daily_prices').upsert(missing, { onConflict: 'ticker,trade_date', ignoreDuplicates: true }).select('trade_date').abortSignal(querySignal());
        if (inserted.error) throw inserted.error;
        writes.push(...(inserted.data ?? []).map((value) => ({ tradeDate: value.trade_date as string, operation: 'insert' as const })));
      }
      const expectedDate = latestCompletedPriceDate(ticker, now);
      const stale = row.trade_date < expectedDate;
      // A stale provider response must never overwrite an existing candle. A
      // fresh response can repair its newest close and proven forming crypto
      // rows in this bounded ten-day catch-up window after missed invocations.
      if (!stale) for (const verified of sourceRows) {
        const prior = stored.get(verified.trade_date);
        if (!prior || pricesMatch(prior, verified)
          || (verified.trade_date !== expectedDate && !storedBeforeCryptoClose(prior, verified))) continue;
        // Omit technical_indicators and timestamps: retain saved model context.
        const write = await supabase.from('etf_daily_prices').upsert(verified, { onConflict: 'ticker,trade_date' }).abortSignal(querySignal());
        if (write.error) throw write.error;
        writes.push({ tradeDate: verified.trade_date, operation: 'update' });
      }
      results.push({ ticker, tradeDate: row.trade_date, expectedDate, stale, changed: writes.length > 0, writes,
        unchangedDates: sourceRows.filter((value) => !writes.some((write) => write.tradeDate === value.trade_date)).map((value) => value.trade_date), row,
        error: stale ? `Yahoo's latest completed ${ticker} bar is ${row.trade_date}; the latest scheduled exchange date is ${expectedDate}.` : null });
    } catch (error) {
      results.push({ ticker, tradeDate: null, changed: false, writes: [], row: null, error: error instanceof Error ? error.message : 'Completed-price storage failed.' });
    }
  }
  return { observedAt: now.toISOString(), ok: results.every((result) => result.error === null), results };
}
