import { createSupabaseAdminClient } from '../supabase/admin';
import { fetchCompletedYahooPrices, latestCompletedPriceDate, type ChartPriceTicker, type CompletedPriceRow } from './completed-price-bars';

const PRICE_COLUMNS = 'ticker,trade_date,open,high,low,close,adjusted_close,volume,source';

function pricesMatch(stored: Record<string, unknown>, row: CompletedPriceRow) {
  return (['open', 'high', 'low', 'close', 'adjusted_close', 'volume'] as const).every((key) => Number(stored[key]) === row[key]) && stored.source === row.source;
}

/** Price-only ingestion. Does not import or execute models, publishers, or delivery. */
export async function syncCompletedMarketPrices(now = new Date()) {
  const supabase = createSupabaseAdminClient();
  const results = [];
  // Sequential requests avoid adding bursts to Yahoo's cloud-IP rate limits.
  for (const ticker of ['SPY', 'BTC-USD'] as const satisfies readonly ChartPriceTicker[]) {
    try {
      const sourceRows = await fetchCompletedYahooPrices(ticker, now);
      const row = sourceRows.at(-1);
      if (!row) throw new Error(`No completed daily price returned for ${ticker}.`);
      const existing = await supabase.from('etf_daily_prices').select(PRICE_COLUMNS)
        .eq('ticker', ticker).gte('trade_date', sourceRows[0].trade_date).lte('trade_date', row.trade_date);
      if (existing.error) throw existing.error;
      const stored = new Map((existing.data ?? []).map((value) => [value.trade_date as string, value]));
      const missing = sourceRows.filter((value) => !stored.has(value.trade_date));
      const writes: Array<{ tradeDate: string; operation: 'insert' | 'update' }> = [];
      if (missing.length) {
        // DO NOTHING on conflict preserves a concurrently inserted historical row.
        const inserted = await supabase.from('etf_daily_prices').upsert(missing, { onConflict: 'ticker,trade_date', ignoreDuplicates: true }).select('trade_date');
        if (inserted.error) throw inserted.error;
        writes.push(...(inserted.data ?? []).map((value) => ({ tradeDate: value.trade_date as string, operation: 'insert' as const })));
      }
      const latestStored = stored.get(row.trade_date);
      if (latestStored && !pricesMatch(latestStored, row)) {
        // Omit technical_indicators and timestamps: retain the existing model context.
        const write = await supabase.from('etf_daily_prices').upsert(row, { onConflict: 'ticker,trade_date' });
        if (write.error) throw write.error;
        writes.push({ tradeDate: row.trade_date, operation: 'update' });
      }
      const expectedDate = latestCompletedPriceDate(ticker, now);
      const stale = row.trade_date < expectedDate;
      results.push({ ticker, tradeDate: row.trade_date, expectedDate, stale, changed: writes.length > 0, writes,
        unchangedDates: sourceRows.filter((value) => !writes.some((write) => write.tradeDate === value.trade_date)).map((value) => value.trade_date), row,
        error: stale ? `Yahoo's latest completed ${ticker} bar is ${row.trade_date}; the latest scheduled exchange date is ${expectedDate}.` : null });
    } catch (error) {
      results.push({ ticker, tradeDate: null, changed: false, writes: [], row: null, error: error instanceof Error ? error.message : 'Completed-price storage failed.' });
    }
  }
  return { observedAt: now.toISOString(), ok: results.every((result) => result.error === null), results };
}
