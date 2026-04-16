import type { Metadata } from "next";

import ReferPageClient from "./refer-page-client";

const SITE_URL = "https://macro-bias.com";

export const metadata: Metadata = {
  title: "Refer a Trader — Earn Free Premium Access | Macro Bias",
  description:
    "Share your Macro Bias referral link with traders you know. 3 verified referrals unlock 7 days of Premium, 7 unlock a free month, and 15 unlock a free annual plan.",
  alternates: {
    canonical: `${SITE_URL}/refer`,
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/refer`,
    siteName: "Macro Bias",
    title: "Refer a Trader — Earn Free Premium Access",
    description:
      "Invite traders, track progress, and unlock Premium rewards automatically.",
  },
};

export default function ReferPage() {
  return <ReferPageClient />;
}