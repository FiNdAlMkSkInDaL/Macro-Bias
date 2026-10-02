import { loadBriefingFeed } from '@/lib/product/briefing-feed';
export const dynamic = 'force-dynamic';
function escapeXml(text: string) { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
export async function GET() {
  try {
    const { appUrl, items } = await loadBriefingFeed();
    const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Macro Bias — Daily Regime Briefings</title><link>${escapeXml(appUrl)}</link><description>Public dated macro regime readings and full briefing access information.</description><language>en-us</language><atom:link href="${escapeXml(appUrl)}/feed.xml" rel="self" type="application/rss+xml" />${items.map((item) => `<item><title>${escapeXml(item.title)}</title><link>${escapeXml(item.url)}</link><guid isPermaLink="true">${escapeXml(item.url)}</guid>${item.date_published ? `<pubDate>${new Date(item.date_published).toUTCString()}</pubDate>` : ''}<description>${escapeXml(item.content_text)}</description><category>Macro Regime</category></item>`).join('')}</channel></rss>`;
    return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
  } catch { return new Response('<rss><channel><title>Briefing feed unavailable</title></channel></rss>', { status: 500, headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } }); }
}
