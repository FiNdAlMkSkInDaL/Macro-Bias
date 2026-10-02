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
  const result = await syncCompletedMarketPrices();
  return NextResponse.json(result, { status: result.ok ? 200 : 502, headers: { 'Cache-Control': 'no-store' } });
}
