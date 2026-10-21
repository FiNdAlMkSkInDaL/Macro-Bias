import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { GrokXError, grokXWindowOpen, previewGrokX, publishGrokX } from '@/lib/social/grok-x-publishing';
import type { DistributionMarket } from '@/lib/social/distribution-content';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
function authorize(request: NextRequest): NextResponse | null {
  // Deployment alone never grants a bot publishing access. Provisioning and
  // handing off this distinct, expiring credential requires owner approval.
  const expected = process.env.GROK_X_PUBLISH_TOKEN?.trim();
  if (process.env.VERCEL_ENV !== 'production' || process.env.GROK_X_PUBLISH_ENABLED !== 'true' || !expected || expected.length < 32) {
    return reply({ error: 'publisher_disabled' }, 503);
  }
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return reply({ error: 'Unauthorized' }, 401);
  }
  if (!grokXWindowOpen(new Date())) return reply({ error: 'experiment_ended' }, 410);
  return null;
}
function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
function market(value: unknown): value is DistributionMarket { return value === 'stocks' || value === 'crypto'; }
function failure(error: unknown) { return error instanceof GrokXError ? reply({ error: error.reason }, error.status) : reply({ error: 'publisher_unavailable' }, 503); }
export async function GET(request: NextRequest) {
  const denied = authorize(request); if (denied) return denied;
  const selected = request.nextUrl.searchParams.get('market');
  if (!market(selected)) return reply({ error: 'invalid_market' }, 400);
  try { return reply(await previewGrokX(selected)); } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  const denied = authorize(request); if (denied) return denied;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 1024) return reply({ error: 'invalid_request' }, 400);
    let body: unknown; try { body = JSON.parse(raw); } catch { return reply({ error: 'invalid_request' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'invalid_request' }, 400);
    const input = body as Record<string, unknown>;
    if (Object.keys(input).sort().join(',') !== 'fingerprint,market' || !market(input.market)
      || typeof input.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(input.fingerprint)) return reply({ error: 'invalid_request' }, 400);
    return reply(await publishGrokX(input.market, input.fingerprint));
  } catch (error) { return failure(error); }
}
