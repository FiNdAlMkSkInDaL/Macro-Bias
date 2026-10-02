import 'server-only';
import { briefingAccess } from './briefing-access';
import { loadPaidBriefingArchive } from './paid-briefing-data';
import { getAppUrl } from '@/lib/server-env';

// Public feeds contain numeric publication metadata only. Full prose, news and
// diagnostics must be read through the signed-in article authorization path.
export async function loadBriefingFeed() {
  const data = await loadPaidBriefingArchive('stocks');
  if (data.loadError) throw new Error('Briefing feed unavailable');
  const appUrl = getAppUrl().replace(/\/$/, '');
  const now = Date.now();
  const items = data.items.slice(0, 50).map((item) => {
    const access = briefingAccess({ signedIn: false, isPro: false }, item.publishedAt, now);
    const label = item.biasLabel.replace(/_/g, ' ');
    const score = item.score === null ? 'Reading unavailable' : `${item.score > 0 ? '+' : ''}${item.score}`;
    const content = access.kind === 'sign-in'
      ? 'Sign in to read the full briefing with a Free account. Scores and dated readings are public.'
      : `Pro includes immediate full briefing access.${access.freeAvailableAt ? ` Available with Free from ${access.freeAvailableAt}.` : ' Free release date unavailable.'} Scores and dated readings are public.`;
    return { id: `${appUrl}/briefings/${item.date}`, url: `${appUrl}/briefings/${item.date}`, title: `${label} (${score}) — ${item.date}`, content_text: content, ...(item.publishedAt ? { date_published: item.publishedAt } : {}), tags: ['Macro Regime', label] };
  });
  return { appUrl, items };
}
