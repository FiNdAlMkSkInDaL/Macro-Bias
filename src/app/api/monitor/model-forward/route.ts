import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { readHostedForwardReport } from '@/lib/model-monitor/read-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Vary': 'Authorization' };
  const expected = process.env.MODEL_MONITOR_READ_TOKEN?.trim();
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!expected || expected.length < 32 || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  try { return NextResponse.json(await readHostedForwardReport(), { headers }); }
  catch { return NextResponse.json({ error: 'Forward report unavailable; no missing results counted as zero' }, { status: 503, headers }); }
}
