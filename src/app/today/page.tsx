import type { Metadata } from 'next';
import { ProDailyPage } from '@/components/product/ProDailyPage';
import { PublicDailyPage } from '@/components/product/PublicDailyPage';
import { MemberDailyPage } from '@/components/product/MemberDailyPage';
import { loadPublicDailyData } from '@/lib/product/public-daily-data';
import { getViewerScore } from '@/lib/product/score-access';
import { loadPaidBriefingLink } from '@/lib/product/paid-briefing-link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Stock score — Macro Bias',
  description:
    'Explore the latest published stock score, SPY price history and the market signals behind Macro Bias. Get free daily stock and crypto updates by email.',
};

export default async function TodayPage() {
  const viewer = await getViewerScore('stocks', undefined, 'latest-publication');

  if (!viewer.signedIn && !viewer.paid) {
    return <PublicDailyPage data={await loadPublicDailyData('stocks', viewer)} />;
  }

  if (!viewer.paid) {
    return <MemberDailyPage data={await loadPublicDailyData('stocks', viewer)} />;
  }

  const [data, briefing] = await Promise.all([
    loadPublicDailyData('stocks', viewer),
    loadPaidBriefingLink('stocks', viewer.score?.tradeDate ?? null, viewer.paid),
  ]);
  return <ProDailyPage data={data} briefing={briefing} />;
}
