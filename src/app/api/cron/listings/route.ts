import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runListingMonitor } from '@/lib/analytics/listing-monitor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.VERCEL_ENV !== 'production') return NextResponse.json({ status: 'production_only' });
  try {
    const result = await runListingMonitor();
    console.info('[listing-monitor]', { status: result.status, endsAt: result.endsAt });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Listing monitoring failed; no successful snapshot confirmed.' }, { status: 503 });
  }
}
