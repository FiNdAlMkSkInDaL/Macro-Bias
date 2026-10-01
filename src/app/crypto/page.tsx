import type { Metadata } from 'next';
import { ProDailyPage } from '@/components/product/ProDailyPage';
import { PublicDailyPage } from '@/components/product/PublicDailyPage';
import { MemberDailyPage } from '@/components/product/MemberDailyPage';
import { loadPublicDailyData } from '@/lib/product/public-daily-data';
import { getViewerScore } from '@/lib/product/score-access';
import { loadPaidBriefingLink } from '@/lib/product/paid-briefing-link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Crypto score — Macro Bias',
  description:
    'Explore the previous published crypto score, Bitcoin price history and the wider market backdrop. Get free daily stock and crypto updates by email.',
};

export default async function CryptoPage() {
  const viewer = await getViewerScore('crypto');

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
