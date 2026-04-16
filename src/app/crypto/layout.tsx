import type { Metadata } from "next";

const SITE_URL = "https://macro-bias.com";

export const metadata: Metadata = {
  title: "Daily Crypto Regime Briefing — BTC Signal | Macro Bias",
  description:
    "A quantitative daily crypto regime score covering BTC, ETH, and altcoins. Backtested +41,576% long-only vs +944% BTC buy-and-hold since 2020.",
  alternates: {
    canonical: `${SITE_URL}/crypto`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/crypto`,
    siteName: "Macro Bias",
    title: "Daily Crypto Regime Briefing | Macro Bias",
    description:
      "Same regime-scoring discipline as equities, tuned for crypto volatility. Free daily email.",
  },
};

export default function CryptoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
