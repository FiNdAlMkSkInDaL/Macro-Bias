import { NextResponse } from 'next/server';
import { getAnalyticsAdminUser } from '@/lib/analytics/admin-access';
import { acquisitionCsv, getAcquisitionReport } from '@/lib/analytics/acquisition-data';
import { parseAcquisitionFilters } from '@/lib/analytics/filters';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: Request) {
  if (!(await getAnalyticsAdminUser())) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
  const params = new URL(request.url).searchParams;
  const view = params.get('view') ?? 'sources';
  let filters;
  try {
    if (!['sources', 'campaigns', 'landings', 'content'].includes(view)) throw new Error('Invalid view');
    filters = parseAcquisitionFilters(params);
  } catch { return NextResponse.json({ error: 'Choose a valid export view and reporting period.' }, { status: 400, headers }); }
  try {
    const report = await getAcquisitionReport(filters);
    return new Response(acquisitionCsv(report, view as 'sources' | 'campaigns' | 'landings' | 'content'), { headers: {
      ...headers, 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="macro-bias-${view}-${report.range.startDate}-${report.range.endDate}.csv"`,
    } });
  } catch { return NextResponse.json({ error: 'The export is temporarily unavailable. Please try again shortly.' }, { status: 503, headers }); }
}
