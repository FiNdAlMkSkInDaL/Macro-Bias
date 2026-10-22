import type { Metadata } from 'next';
import { ProDailyPage } from '@/components/product/ProDailyPage';
import { PublicDailyPage } from '@/components/product/PublicDailyPage';
import { MemberDailyPage } from '@/components/product/MemberDailyPage';
import { loadPublicDailyData } from '@/lib/product/public-daily-data';
import { getViewerScore } from '@/lib/product/score-access';
import { loadPaidBriefingLink } from '@/lib/product/paid-briefing-link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Free crypto newsletter and daily market score',
  description:
    'See the latest published crypto market score and Bitcoin history. Get the score and a short market update free by email every day. No account needed.',
  alternates: { canonical: '/crypto' },
  openGraph: { title: 'A wider view of crypto — Macro Bias', description: 'The published crypto score and a short market update, free by email every day.', url: '/crypto' },
};

export default async function CryptoPage() {
  const viewer = await getViewerScore('crypto', undefined, 'latest-publication', { includeExplanation: true });

  if (!viewer.signedIn && !viewer.paid) {
    return <PublicDailyPage data={await loadPublicDailyData('crypto', viewer)} />;
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
