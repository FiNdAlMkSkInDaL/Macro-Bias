import 'server-only';
import { briefingAccess } from './briefing-access';
import { loadPaidBriefingArchive } from './paid-briefing-data';
import { getAppUrl } from '@/lib/server-env';

// Public feeds contain numeric publication metadata only. Full prose, news and
// diagnostics must be read through the signed-in article authorization path.
export async function loadBriefingFeed(market?: 'stocks' | 'crypto') {
  const markets: ('stocks' | 'crypto')[] = market ? [market] : ['stocks', 'crypto'];
  const archives = await Promise.all(markets.map(async asset => ({ asset, data: await loadPaidBriefingArchive(asset) })));
  if (archives.some(({ data }) => data.loadError)) throw new Error('Briefing feed unavailable');
  const appUrl = getAppUrl().replace(/\/$/, '');
  const now = Date.now();
  const items = archives.flatMap(({ asset, data }) => data.items.filter(item => item.publishedAt && Date.parse(item.publishedAt) <= now).slice(0, market ? 50 : 25).map((item) => {
    const access = briefingAccess({ signedIn: false, isPro: false }, item.publishedAt, now);
    const label = item.biasLabel.replace(/_/g, ' ');
    const score = item.score === null ? 'Reading unavailable' : `${item.score > 0 ? '+' : ''}${item.score}`;
    const content = access.kind === 'sign-in'
      ? 'Sign in to read the full briefing with a Free account. Scores and dated readings are public.'
      : `Pro includes immediate full briefing access.${access.freeAvailableAt ? ` Available with Free from ${access.freeAvailableAt}.` : ' Free release date unavailable.'} Scores and dated readings are public.`;
    const url = `${appUrl}${asset === 'crypto' ? '/crypto' : ''}/briefings/${item.date}`;
    const link = new URL(url);
    link.search = new URLSearchParams({ utm_source: 'rss', utm_medium: 'syndication', utm_campaign: 'mb_briefing_feed_v1', utm_content: `${asset}_${item.date}` }).toString();
    return { id: url, url: link.toString(), title: `${asset === 'stocks' ? 'Stocks' : 'Crypto'}: ${label} (${score}) — ${item.date}`, content_text: `${asset === 'stocks' ? 'Stock' : 'Crypto'} model reading: ${score} (${label}). ${item.overrideActive ? 'News override active; the chart shows the base model. ' : ''}Market context, not a prediction. ${content}`, ...(item.score !== null ? { image: `${appUrl}/charts/${asset}/${item.date}` } : {}), ...(item.publishedAt ? { date_published: item.publishedAt } : {}), tags: [asset, 'Macro Regime', label] };
  })).sort((a, b) => (b.date_published ?? '').localeCompare(a.date_published ?? ''));
  return { appUrl, items };
}
