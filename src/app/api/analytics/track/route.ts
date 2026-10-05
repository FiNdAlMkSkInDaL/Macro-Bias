import { NextResponse } from 'next/server';
import { logMarketingEvent } from '@/lib/analytics/server';
import { isKnownTestTraffic } from '@/lib/analytics/attribution';
import { normalizePublicCapture } from '@/lib/analytics/public-capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
const MAX_BODY_BYTES = 8192;

async function readPayload(request: Request): Promise<unknown> {
  if (!request.body) throw new Error('Missing body.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new RangeError('Body too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin !== requestUrl.origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Same-origin capture required.' }, { status: 403 });
  }
  if (isKnownTestTraffic(requestUrl.hostname, request.headers.get('user-agent') ?? '')) {
    return NextResponse.json({ ok: true, skipped: true }, { status: 202 });
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'JSON content required.' }, { status: 415 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
  }
  let payload: unknown;
  try {
    payload = await readPayload(request);
  } catch (error) {
    return NextResponse.json({ error: 'Invalid or oversized JSON.' }, { status: error instanceof RangeError ? 413 : 400 });
  }
  const normalized = normalizePublicCapture(payload, {
    cookieHeader: request.headers.get('cookie'), dnt: request.headers.get('dnt'), gpc: request.headers.get('sec-gpc'),
  });
  if (normalized.error) return NextResponse.json({ error: normalized.error }, { status: 400 });
  if (!normalized.event) return NextResponse.json({ ok: true, skipped: true }, { status: 202 });
  try {
    // Existing PK makes repeated beacon/fetch delivery of one navigation a no-op.
    await logMarketingEvent(normalized.event);
  } catch {
    return NextResponse.json({ error: 'Capture unavailable.' }, { status: 503 });
  }
  return NextResponse.json({ ok: true }, { status: 202 });
}