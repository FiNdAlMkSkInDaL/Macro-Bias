import { NextResponse } from "next/server";

import { getAnalyticsAdminUser } from '@/lib/analytics/admin-access';
import { getAcquisitionReport } from '@/lib/analytics/acquisition-data';
import { parseAcquisitionFilters } from '@/lib/analytics/filters';

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };

export async function GET(request: Request) {
  const user = await getAnalyticsAdminUser();

  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  }

  let filters;
  try { filters = parseAcquisitionFilters(new URL(request.url).searchParams); }
  catch { return NextResponse.json({ error: 'Choose a valid date range, source and attribution view.' }, { status: 400, headers }); }
  try { return NextResponse.json(await getAcquisitionReport(filters), { headers }); }
  catch { return NextResponse.json({ error: 'Analytics is temporarily unavailable. Please refresh shortly.' }, { status: 503, headers }); }
}
