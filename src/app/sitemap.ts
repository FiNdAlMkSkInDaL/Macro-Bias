import type { MetadataRoute } from "next";

import { getAppUrl } from "@/lib/server-env";

export default function sitemap(): MetadataRoute.Sitemap {
  const appUrl = getAppUrl().replace(/\/$/, "");
  const now = new Date();

  return [
    { url: appUrl, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${appUrl}/today`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${appUrl}/crypto`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${appUrl}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${appUrl}/track-record`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${appUrl}/crypto/track-record`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${appUrl}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
  ];
}
