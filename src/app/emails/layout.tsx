import type { Metadata } from "next";
import type { ReactNode } from "react";

const SITE_URL = "https://macro-bias.com";

export const metadata: Metadata = {
  title: "Free Daily Market Briefing | Macro Bias",
  description:
    "Know what the market is doing before you trade. Free daily email with the directional bias, sector breakdown, and historical context. 90 seconds, every morning before the bell.",
  alternates: {
    canonical: `${SITE_URL}/emails`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/emails`,
    siteName: "Macro Bias",
    title: "Free Daily Market Briefing | Macro Bias",
    description:
      "Know what the market is doing before you trade. Free daily email with the directional bias, sector breakdown, and historical context. 90 seconds, every morning before the bell.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Daily Market Briefing | Macro Bias",
    description:
      "Know what the market is doing before you trade. Free daily email with the directional bias, sector breakdown, and historical context. 90 seconds, every morning before the bell.",
  },
};

type EmailsLayoutProps = {
  children: ReactNode;
};

export default function EmailsLayout({ children }: EmailsLayoutProps) {
  return children;
}
