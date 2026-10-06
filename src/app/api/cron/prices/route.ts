import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { syncCompletedMarketPrices } from '@/lib/market-data/sync-completed-market-prices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() || process.env.PUBLISH_CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: 'Price sync is not configured.' }, { status: 503 });
  const provided = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await syncCompletedMarketPrices();
    const summary = {
      observedAt: result.observedAt,
      ok: result.ok,
      results: result.results.map((entry) => ({
        ticker: entry.ticker,
        tradeDate: entry.tradeDate,
        expectedDate: 'expectedDate' in entry ? entry.expectedDate : null,
        changed: entry.changed,
        writes: entry.writes,
        error: entry.error,
      })),
    };
    console[result.ok ? 'info' : 'error'](`[prices-cron] ${JSON.stringify(summary)}`);
    return NextResponse.json(result, { status: result.ok ? 200 : 502, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Completed-price sync failed.';
    console.error(`[prices-cron] ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
