import type { Metadata } from 'next';
import { ProDailyPage } from '@/components/product/ProDailyPage';
import { PublicDailyPage } from '@/components/product/PublicDailyPage';
import { MemberDailyPage } from '@/components/product/MemberDailyPage';
import { loadPublicDailyData } from '@/lib/product/public-daily-data';
import { getViewerScore } from '@/lib/product/score-access';
import { loadPaidBriefingLink } from '@/lib/product/paid-briefing-link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Free stock market newsletter and daily score',
  description:
    'See the latest published stock market score and SPY history. Get the score and a short market update free by email on market days. No account needed.',
  alternates: { canonical: '/today' },
  openGraph: { title: 'A wider view of the stock market — Macro Bias', description: 'The published stock score and a short market update, free by email on market days.', url: '/today' },
};

export default async function TodayPage() {
  const viewer = await getViewerScore('stocks', undefined, 'latest-publication', { includeExplanation: true });

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
