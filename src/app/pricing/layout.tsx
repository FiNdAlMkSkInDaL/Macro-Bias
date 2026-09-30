import type { Metadata } from "next";
import type { ReactNode } from "react";

const SITE_URL = "https://macro-bias.com";

export const metadata: Metadata = {
  title: "Pricing — Macro Bias",
  description:
    "Free sees the previous session. Paid sees today's stock and crypto score, the grade, the size hint, and the morning email. Not financial advice.",
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
      "Free sees the previous session. Paid sees today's score, grade, size hint, and morning email.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pricing — Macro Bias",
    description:
      "Today's stock and crypto score for subscribers. Not financial advice.",
  },
};

type PricingLayoutProps = {
  children: ReactNode;
};

export default function PricingLayout({ children }: PricingLayoutProps) {
  return children;
}
