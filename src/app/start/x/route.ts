import { NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/server-env';

/** Fixed profile link; destination collection retains existing consent/bot exclusions. */
export function GET() {
  const target = new URL('/learn', getAppUrl());
  target.search = new URLSearchParams({ utm_source: 'x', utm_medium: 'profile', utm_campaign: 'mb_acquisition_turnaround_20261104', utm_content: 'profile' }).toString();
  return NextResponse.redirect(target, { status: 307, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
