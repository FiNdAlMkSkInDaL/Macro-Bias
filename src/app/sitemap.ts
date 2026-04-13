import type { MetadataRoute } from "next";

import { getAppUrl } from "@/lib/server-env";
import { ALL_REGIME_SLUGS } from "@/lib/regime/regime-data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type PublishedMarketingPost = {
  slug: string;
  published_at: string;
};

type BriefingDateRow = {
  briefing_date: string;
  generated_at: string;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const appUrl = getAppUrl().replace(/\/$/, "");
  const supabase = createSupabaseAdminClient();

  const [postsResult, briefingsResult] = await Promise.all([
    supabase
      .from("published_marketing_posts")
      .select("slug, published_at")
      .order("published_at", { ascending: false }),
    supabase
      .from("daily_market_briefings")
      .select("briefing_date, generated_at")
      .order("briefing_date", { ascending: false }),
  ]);

  if (postsResult.error) {
    throw new Error(`Failed to load published marketing posts for sitemap: ${postsResult.error.message}`);
  }

  if (briefingsResult.error) {
    throw new Error(`Failed to load briefing dates for sitemap: ${briefingsResult.error.message}`);
  }

  const publishedPosts = (postsResult.data as PublishedMarketingPost[] | null) ?? [];
  const briefingRows = (briefingsResult.data as BriefingDateRow[] | null) ?? [];

  // Deduplicate briefing dates (keep latest generated_at per date)
  const seenDates = new Set<string>();
  const uniqueBriefings = briefingRows.filter((row) => {
    if (seenDates.has(row.briefing_date)) return false;
    seenDates.add(row.briefing_date);
    return true;
  });

  return [
    {
      url: appUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${appUrl}/emails`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${appUrl}/pricing`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${appUrl}/briefings`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${appUrl}/regime`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...ALL_REGIME_SLUGS.map((slug) => ({
      url: `${appUrl}/regime/${slug}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.85,
    })),
    ...uniqueBriefings.map((row) => ({
      url: `${appUrl}/briefings/${row.briefing_date}`,
      lastModified: new Date(row.generated_at),
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...publishedPosts.map((post) => ({
      url: `${appUrl}/intel/${post.slug}`,
      lastModified: new Date(post.published_at),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}