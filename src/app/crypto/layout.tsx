import type { Metadata } from "next";

const SITE_URL = "https://macro-bias.com";

export const metadata: Metadata = {
  title: "Daily Crypto Regime Briefing — BTC Signal | Macro Bias",
  description:
    "A daily crypto score from -100 to +100. Paid subscribers see today's permission, grade, and size hint.",
  alternates: {
    canonical: `${SITE_URL}/crypto`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/crypto`,
    siteName: "Macro Bias",
    title: "Daily Crypto Regime Briefing | Macro Bias",
    description:
      "A daily crypto score from -100 to +100. Paid subscribers see today's permission, grade, and size hint.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Daily Crypto Regime Briefing | Macro Bias",
    description:
      "A daily crypto score from -100 to +100. Paid subscribers see today's permission, grade, and size hint.",
  },
};

export default function CryptoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
