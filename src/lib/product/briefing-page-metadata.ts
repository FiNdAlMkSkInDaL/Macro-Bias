import 'server-only';
import type { Metadata } from 'next';
import { getAppUrl } from '@/lib/server-env';
import { getBriefingMetadata, isPaidBriefingDate } from './paid-briefing-data';
import type { ProductAsset } from './score-access';

// Search/social metadata uses only intentionally public publication/score data.
// Never load an article body, model diagnostics or news to build a preview.
export async function briefingPageMetadata(asset: ProductAsset, date: string): Promise<Metadata> {
  const market = asset === 'stocks' ? 'Stock' : 'Crypto';
  const path = asset === 'stocks' ? '/briefings' : '/crypto/briefings';
  const canonical = `${getAppUrl().replace(/\/$/, '')}${path}/${date}`;
  if (!isPaidBriefingDate(date)) return { title: 'Briefing unavailable', robots: { index: false, follow: false } };
  let item = null;
  try { item = await getBriefingMetadata(asset, date); } catch { /* Safe generic preview on a metadata outage. */ }
  const title = `${market} briefing — ${date}`;
  const reading = item?.score != null ? ` Public reading: ${item.score > 0 ? '+' : ''}${item.score} (${item.biasLabel.replace(/_/g, ' ')}).` : '';
  const description = `Published ${market.toLowerCase()} briefing for ${date}.${reading} Pro includes immediate full access; signed-in Free accounts can read the full article seven calendar days after publication.`;
  return {
    title, description, alternates: { canonical },
    openGraph: { type: 'article', title, description, url: canonical, ...(item?.publishedAt ? { publishedTime: item.publishedAt } : {}) },
    twitter: { card: 'summary', title, description },
  };
}
