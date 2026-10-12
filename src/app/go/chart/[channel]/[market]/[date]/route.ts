import { NextResponse } from 'next/server';
import { distributionDestination } from '@/lib/social/distribution-content';

export async function GET(_request: Request, context: { params: Promise<{ channel: string; market: string; date: string }> }) {
  const { channel, market, date } = await context.params;
  const destination = distributionDestination(channel, market, date, true);
  if (!destination) return new Response('Not found', { status: 404 });
  return NextResponse.redirect(destination, { status: 307, headers: { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' } });
}
