import type { Metadata } from 'next';

import { getUserSubscriptionStatus } from '@/lib/billing/subscription';
import { loadReferralHub } from '@/lib/referral/load-referral-hub';

import ReferPageClient from './refer-page-client';

const SITE_URL = 'https://macro-bias.com';
export const metadata: Metadata = {
  title: 'Your referrals — Macro Bias',
  description: 'Share your Macro Bias referral link, follow verified referrals, and review recorded referral rewards.',
  alternates: { canonical: `${SITE_URL}/refer` },
  openGraph: {
    type: 'website', url: `${SITE_URL}/refer`, siteName: 'Macro Bias',
    title: 'Your referrals — Macro Bias',
    description: 'Share your link and follow verified referrals.',
  },
};

export default async function ReferPage() {
  let email: string | null = null;
  let signedIn = false;
  try {
    const { isPro, user } = await getUserSubscriptionStatus();
    signedIn = Boolean(user);
    email = user?.email?.trim().toLowerCase() || null;
    const result = email ? await loadReferralHub(email, { proOverride: isPro }) : null;
    const needsSubscription = Boolean(email && !isPro && result && !result.ok && result.status === 404);
    return <ReferPageClient signedIn={signedIn} initialEmail={email} initialError={result && !result.ok && !needsSubscription ? 'Referrals are temporarily unavailable. Please try again.' : null} initialHub={result && result.ok ? result.hub : null} initialUpsell={needsSubscription} />;
  } catch {
    return <ReferPageClient signedIn={signedIn} initialEmail={email} initialError="Referrals are temporarily unavailable. Please try again." />;
  }
}
