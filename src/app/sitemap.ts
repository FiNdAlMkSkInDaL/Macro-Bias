import type { MetadataRoute } from "next";

import { getAppUrl } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type PublishedMarketingPost = {
  slug: string;
  published_at: string;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const appUrl = getAppUrl().replace(/\/$/, "");
  const supabase = createSupabaseAdminClient();

  const { data: publishedPosts, error } = await supabase
    .from("published_marketing_posts")
    .select("slug, published_at")
    .order("published_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load published marketing posts for sitemap: ${error.message}`);
  }

  return [
    {
      url: appUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    ...((publishedPosts as PublishedMarketingPost[] | null) ?? []).map((post) => ({
      url: `${appUrl}/intel/${post.slug}`,
      lastModified: new Date(post.published_at),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}