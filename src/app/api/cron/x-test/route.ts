import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runXTest } from '@/lib/social/x-experiment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim(), supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  try {
    const publishingEnabled = process.env.VERCEL_ENV === 'production' && process.env.X_COMMENTARY_MODE === 'live';
    const result = await runXTest({ live: publishingEnabled,
      preview: request.nextUrl.searchParams.get('preview') === '1' });
    console.info('[x-test]', { mode: result.mode, ok: result.ok, ...('result' in result ? { result: result.result } : {}) });
    return NextResponse.json({ ...result, publishingEnabled }, { status: result.ok ? 200 : 503, headers });
  } catch {
    return NextResponse.json({ error: 'X test unavailable; check private delivery health' }, { status: 503, headers });
  }
}
