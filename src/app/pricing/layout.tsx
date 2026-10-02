import type { Metadata } from "next";
import type { ReactNode } from "react";

const SITE_URL = "https://macro-bias.com";

export const metadata: Metadata = {
  title: "Pricing — Macro Bias",
  description:
    "Explore public scores and history for free. Sign in for full briefings seven full days after original publication. Pro includes current stock and crypto briefings, workspaces, decisions and evidence.",
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
      "Free history and older full briefings. Current stock and crypto briefings and workspaces with Pro, from $25 monthly or $190 annually.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pricing — Macro Bias",
    description:
      "Current stock and crypto briefings, decisions and evidence with Pro. $25 monthly or $190 annually.",
  },
};

type PricingLayoutProps = {
  children: ReactNode;
};

export default function PricingLayout({ children }: PricingLayoutProps) {
  return children;
}
