import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const SITE_URL = "https://macro-bias.com";
const SITE_NAME = "Macro Bias";
const SITE_TITLE = "Macro Bias | Macro Regime Signals for Day Traders";
const SITE_DESCRIPTION =
  "Macro Bias gives day traders and quant-focused investors a live macro regime dashboard powered by SPY, QQQ, XLP, TLT, GLD, VIX, and HYG signals.";
const SITE_KEYWORDS = [
  "macro bias",
  "day trading signals",
  "macro analysis for traders",
  "quant trading model",
  "risk on risk off dashboard",
  "SPY QQQ VIX HYG analysis",
  "macro regime indicator",
  "day trader macro dashboard",
  "quant model for day traders",
  "market regime scoring",
  "macro risk dashboard",
  "intermarket analysis",
];

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: SITE_NAME,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      description: SITE_DESCRIPTION,
      url: SITE_URL,
      audience: {
        "@type": "Audience",
        audienceType: "Day traders, active traders, and macro-focused quantitative investors",
      },
      featureList: [
        "Macro regime scoring for day traders",
        "SPY, QQQ, XLP, TLT, and GLD dashboard tracking",
        "VIX and HYG signal integration in the backend model",
        "Quant-style intermarket monitoring for macro risk shifts",
        "Premium heatmap workflow for fast pre-market context",
      ],
      keywords: SITE_KEYWORDS.join(", "),
      offers: {
        "@type": "Offer",
        "@id": `${SITE_URL}/#offer-monthly`,
        url: SITE_URL,
        price: "19",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        category: "Subscription",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          billingIncrement: 1,
          billingDuration: 1,
          price: "19",
          priceCurrency: "USD",
          unitCode: "MON",
        },
      },
    },
    {
      "@type": "Product",
      "@id": `${SITE_URL}/#product`,
      name: "Macro Bias Pro",
      brand: {
        "@type": "Brand",
        name: SITE_NAME,
      },
      description:
        "A subscription macro intelligence product for day traders that translates SPY, QQQ, VIX, HYG, and intermarket data into a single usable regime signal.",
      category: "Financial Analytics Software",
      audience: {
        "@type": "Audience",
        audienceType: "Day traders",
      },
      additionalProperty: [
        {
          "@type": "PropertyValue",
          name: "Core tracked markets",
          value: "SPY, QQQ, XLP, TLT, GLD, VIX, HYG, CPER",
        },
        {
          "@type": "PropertyValue",
          name: "Pricing model",
          value: "$19 per month subscription",
        },
        {
          "@type": "PropertyValue",
          name: "Primary use case",
          value: "Macro regime context for day traders and quant workflows",
        },
      ],
      offers: {
        "@id": `${SITE_URL}/#offer-monthly`,
      },
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s | Macro Bias",
  },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  applicationName: SITE_NAME,
  category: "finance",
  icons: {
    icon: [
      {
        url: "/favicon.ico",
        sizes: "any",
      },
      {
        url: "/icon.png",
        type: "image/png",
        sizes: "512x512",
      },
    ],
    apple: [
      {
        url: "/apple-icon.png",
        type: "image/png",
        sizes: "180x180",
      },
    ],
    shortcut: ["/favicon.ico"],
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Today's Macro Weather Report from Macro Bias",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/twitter-image.png"],
  },
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-50 antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
      </body>
    </html>
  );
}