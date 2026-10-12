import { loadPublishedChart, renderPublishedChart } from '@/lib/social/distribution-chart';
import { isDistributionDate } from '@/lib/social/distribution-content';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ market: string; date: string }> }) {
  const { market, date } = await context.params;
  if (!['stocks', 'crypto'].includes(market) || !isDistributionDate(date)) return new Response('Chart not found', { status: 404 });
  try {
    const chart = await loadPublishedChart(market as 'stocks' | 'crypto', date);
    if (!chart) return new Response('Chart not found', { status: 404 });
    const response = renderPublishedChart(chart);
    response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
    return response;
  } catch { return new Response('Chart temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
