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
  title: 'Free stock market newsletter: what moved and what to watch',
  description:
    'See a real published summary before joining. What moved, how US stock benchmarks compare, and what to watch next. Free email updates on market days; no account needed.',
  alternates: { canonical: '/today' },
  openGraph: { title: 'Make sense of the stock market — Macro Bias', description: 'What moved, how US stock benchmarks compare, and what to watch next. Free email updates on market days.', url: '/today' },
};

export default async function TodayPage() {
  const viewer = await getViewerScore('stocks', undefined, 'latest-publication', { includeExplanation: true });

  if (!viewer.signedIn && !viewer.paid) {
    const [data, summary] = await Promise.all([
      loadPublicDailyData('stocks', viewer),
      viewer.score ? loadPublicBriefingSummary('stocks', viewer.score.tradeDate) : Promise.resolve(null),
    ]);
    return <PublicDailyPage data={data} sample={summary && viewer.score ? { date: viewer.score.tradeDate, summary } : null} />;
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
