import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runModelForward, recordForwardFailure } from '@/lib/model-forward/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim(), supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const preview = request.nextUrl.searchParams.get('preview') === '1' || process.env.VERCEL_ENV !== 'production' || process.env.MODEL_FORWARD_MODE === 'paused';
  try {
    const result = await runModelForward({ preview });
    return NextResponse.json(result, { status: result.ok ? 200 : 503, headers });
  } catch {
    console.error('[model-forward] collection unavailable');
    if (!preview) { try { await recordForwardFailure(); } catch { /* Provider logs retain the failure if storage is unavailable too. */ } }
    return NextResponse.json({ error: 'Forward test unavailable; no missing results counted as zero' }, { status: 503, headers });
  }
}
