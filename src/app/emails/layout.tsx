import type { Metadata } from "next";
import type { ReactNode } from "react";

const SITE_URL = "https://macro-bias.com";

export const metadata: Metadata = {
  title: "Free Daily Macro Briefing | Macro Bias",
  description:
    "Get the algo's macro regime score, K-NN historical analog read, and sector playbook delivered to your inbox every morning before the open. Free.",
  alternates: {
    canonical: `${SITE_URL}/emails`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/emails`,
    siteName: "Macro Bias",
    title: "Free Daily Macro Briefing | Macro Bias",
    description:
      "Get the algo's macro regime score, K-NN historical analog read, and sector playbook delivered to your inbox every morning before the open. Free.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Daily Macro Briefing | Macro Bias",
    description:
      "Get the algo's macro regime score, K-NN historical analog read, and sector playbook delivered to your inbox every morning before the open. Free.",
  },
};

type EmailsLayoutProps = {
  children: ReactNode;
};

export default function EmailsLayout({ children }: EmailsLayoutProps) {
  return children;
}
