import type { Metadata } from 'next';
import { ProDailyPage } from '@/components/product/ProDailyPage';
import { PublicDailyPage } from '@/components/product/PublicDailyPage';
import { MemberDailyPage } from '@/components/product/MemberDailyPage';
import { loadPublicDailyData } from '@/lib/product/public-daily-data';
import { getViewerScore } from '@/lib/product/score-access';
import { loadPaidBriefingLink } from '@/lib/product/paid-briefing-link';
import { loadPublicBriefingSummary } from '@/lib/product/public-briefing-summary-data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Free crypto newsletter: what moved and what to watch',
  description:
    'See a real published summary before joining. What moved, how Bitcoin and Ethereum compare, and what to watch next. Free daily email updates; no account needed.',
  alternates: { canonical: '/crypto' },
  openGraph: { title: 'Make sense of the crypto market — Macro Bias', description: 'What moved, how Bitcoin and Ethereum compare, and what to watch next. Free daily email updates.', url: '/crypto' },
};

export default async function CryptoPage() {
  const viewer = await getViewerScore('crypto', undefined, 'latest-publication', { includeExplanation: true });

  if (!viewer.signedIn && !viewer.paid) {
    const [data, summary] = await Promise.all([
      loadPublicDailyData('crypto', viewer),
      viewer.score ? loadPublicBriefingSummary('crypto', viewer.score.tradeDate) : Promise.resolve(null),
    ]);
    return <PublicDailyPage data={data} sample={summary && viewer.score ? { date: viewer.score.tradeDate, summary } : null} />;
  }

  if (!viewer.paid) {
    return <MemberDailyPage data={await loadPublicDailyData('crypto', viewer)} />;
  }

  const [data, briefing] = await Promise.all([
    loadPublicDailyData('crypto', viewer),
    loadPaidBriefingLink('crypto', viewer.score?.tradeDate ?? null, viewer.paid),
  ]);
  return <ProDailyPage data={data} briefing={briefing} />;
}
