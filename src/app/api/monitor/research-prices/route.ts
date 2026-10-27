import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { forwardDependencies } from '@/lib/model-forward/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Completed public market quotes only. No collection, subscriber or scoring writes. */
export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', Vary: 'Authorization' };
  const expected = process.env.MODEL_MONITOR_READ_TOKEN?.trim();
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!expected || expected.length < 32 || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  try {
    const deps = forwardDependencies(), now = deps.clock();
    const prices = await deps.readPrices(now);
    return NextResponse.json({ version: 'private-research-prices-v1', completeRead: true, asOf: now.toISOString(),
      sourceRevision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null, prices }, { headers });
  } catch {
    return NextResponse.json({ error: 'Completed market prices unavailable; no missing quotes inferred' }, { status: 503, headers });
  }
}
