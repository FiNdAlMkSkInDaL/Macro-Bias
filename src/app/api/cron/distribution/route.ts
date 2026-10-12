import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runDistribution, distributionDeliveryHealth } from '@/lib/social/distribution';
import type { DistributionChannel } from '@/lib/social/distribution-content';
import { recordDistributionGrowth } from '@/lib/social/distribution-growth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const previewBoth = request.nextUrl.searchParams.get('preview') === '1';
  const channels = (process.env.DISTRIBUTION_CHANNELS ?? 'bluesky').split(',').map(value => value.trim());
  if (channels.length === 0 || channels.some(value => !['bluesky', 'threads'].includes(value))) {
    return NextResponse.json({ error: 'Invalid distribution channels' }, { status: 503 });
  }
  try {
    const result = await runDistribution({
      live: process.env.VERCEL_ENV === 'production' && process.env.DISTRIBUTION_MODE === 'live',
      previewBoth, channels: channels as DistributionChannel[],
    });
    const deliveries = await distributionDeliveryHealth();
    const growth = result.mode === 'live' ? await recordDistributionGrowth() : null;
    const ok = result.ok && !deliveries.some(item => item.status === 'needs_review');
    console.info('[distribution]', { mode: result.mode, scheduledMarkets: result.scheduledMarkets, ok,
      results: result.results.map(({ market, channel, date, status, reason }) => ({ market, channel, date, status, reason })) });
    return NextResponse.json({ ...result, ok, deliveries, growth }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Distribution unavailable' }, { status: 503 });
  }
}
