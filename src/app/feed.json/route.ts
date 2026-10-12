import { loadBriefingFeed } from '@/lib/product/briefing-feed';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const requested = new URL(request.url).searchParams.get('market');
    if (requested && !['stocks', 'crypto'].includes(requested)) return Response.json({ error: 'Unknown market' }, { status: 400 });
    const { appUrl, items } = await loadBriefingFeed((requested as 'stocks' | 'crypto' | null) ?? undefined);
    return Response.json({ version: 'https://jsonfeed.org/version/1.1', title: 'Macro Bias — Daily Regime Briefings', home_page_url: appUrl, feed_url: `${appUrl}/feed.json${requested ? `?market=${requested}` : ''}`, description: 'Public dated stock and crypto readings and full briefing access information.', icon: `${appUrl}/icon.png`, favicon: `${appUrl}/favicon.ico`, language: 'en-US', items }, { headers: { 'Content-Type': 'application/feed+json; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
  } catch { return Response.json({ error: 'Failed to load briefings' }, { status: 500 }); }
}
