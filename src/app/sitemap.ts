import type { MetadataRoute } from "next";

import { getAppUrl } from "@/lib/server-env";
import { loadPaidBriefingArchive } from '@/lib/product/paid-briefing-data';
import { ALL_REGIME_SLUGS } from '@/lib/regime/regime-data';
import { getAllMarketingPosts } from '@/lib/marketing/markdown-parser';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const appUrl = getAppUrl().replace(/\/$/, "");
  const [stocks, crypto, posts] = await Promise.all([
    loadPaidBriefingArchive('stocks'), loadPaidBriefingArchive('crypto'), getAllMarketingPosts('marketing'),
  ]);
  // A failed read must not silently replace a complete sitemap with an empty archive.
  if (stocks.loadError || crypto.loadError) throw new Error('Sitemap publication data unavailable');
  const now = Date.now();
  const published = (items: typeof stocks.items, path: string): MetadataRoute.Sitemap => items
    .filter(item => item.publishedAt && Date.parse(item.publishedAt) <= now)
    .map(item => ({ url: `${appUrl}${path}/${item.date}`, lastModified: item.publishedAt!, changeFrequency: 'monthly', priority: 0.5 }));

  return [
    { url: appUrl, changeFrequency: "daily", priority: 1 },
    ...['/today', '/crypto'].map(path => ({ url: `${appUrl}${path}`, changeFrequency: 'daily' as const, priority: 0.9 })),
    ...['/briefings', '/crypto/briefings', '/track-record', '/crypto/track-record'].map(path => ({ url: `${appUrl}${path}`, changeFrequency: 'daily' as const, priority: 0.7 })),
    ...['/pricing', '/about', '/faq', '/regime'].map(path => ({ url: `${appUrl}${path}`, changeFrequency: 'monthly' as const, priority: 0.6 })),
    ...ALL_REGIME_SLUGS.map(slug => ({ url: `${appUrl}/regime/${slug}`, changeFrequency: 'monthly' as const, priority: 0.5 })),
    ...posts.map(post => ({ url: `${appUrl}/intel/${post.slug}`, changeFrequency: 'monthly' as const, priority: 0.5 })),
    ...published(stocks.items, '/briefings'), ...published(crypto.items, '/crypto/briefings'),
    ...['/terms', '/privacy'].map(path => ({ url: `${appUrl}${path}`, changeFrequency: 'yearly' as const, priority: 0.3 })),
  ];
}
