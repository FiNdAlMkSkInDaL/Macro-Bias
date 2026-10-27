import type { MetadataRoute } from "next";

import { getAppUrl } from '@/lib/server-env';

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getAppUrl().replace(/\/$/, '');
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/crypto/dashboard", "/account", "/auth", "/api", "/analytics", "/test"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
