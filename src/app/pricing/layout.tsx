import type { Metadata } from "next";
import type { ReactNode } from "react";

const SITE_URL = "https://macro-bias.com";

export const metadata: Metadata = {
  title: "Pricing — Macro Bias | Daily Regime Signals for Traders",
  description:
    "Start with a 7-day free trial. Get the daily macro regime score, full sector breakdown, historical pattern analysis, and crypto regime signals. $25/month or $190/year.",
  keywords: [
    "macro bias pricing",
    "trading signal subscription",
    "day trading signal cost",
    "quant model pricing",
    "market regime subscription",
  ],
  alternates: {
    canonical: `${SITE_URL}/pricing`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/pricing`,
    siteName: "Macro Bias",
    title: "Pricing — Macro Bias",
    description:
      "7-day free trial. Daily macro regime score, sector breakdown, pattern analysis, and crypto signals. From $25/month.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pricing — Macro Bias",
    description:
      "7-day free trial. Daily macro + crypto regime signals from $25/month.",
  },
};

type PricingLayoutProps = {
  children: ReactNode;
};

export default function PricingLayout({ children }: PricingLayoutProps) {
  return children;
}
