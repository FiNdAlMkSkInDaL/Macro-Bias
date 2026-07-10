import type { Metadata } from "next";

const SITE_URL = "https://macro-bias.com";

export const metadata: Metadata = {
  title: "Daily Crypto Regime Briefing — BTC Signal | Macro Bias",
  description:
    "A quantitative daily crypto regime score covering BTC, ETH, and altcoins. Tradable permission, reliability grade, and a live paper ledger from published scores.",
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
  twitter: {
    card: "summary_large_image",
    title: "Daily Crypto Regime Briefing | Macro Bias",
    description:
      "Quantitative daily crypto regime score with a live paper ledger from published scores.",
  },
};

export default function CryptoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
