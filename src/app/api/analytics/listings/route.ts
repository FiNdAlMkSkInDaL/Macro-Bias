import { NextResponse } from 'next/server';
import { getAnalyticsAdminUser } from '@/lib/analytics/admin-access';
import { listingMonitorHistory, LISTING_MONITOR_END } from '@/lib/analytics/listing-monitor';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
export async function GET() {
  if (!await getAnalyticsAdminUser()) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
  try {
    return NextResponse.json({ endsAt: LISTING_MONITOR_END, snapshots: await listingMonitorHistory() }, { headers });
  } catch {
    return NextResponse.json({ error: 'Listing monitoring history unavailable' }, { status: 503, headers });
  }
}
