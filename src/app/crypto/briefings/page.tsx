import type { Metadata } from 'next';
import { PaidBriefingArchive } from '@/components/product/PaidBriefingArchive';
import { getBriefingViewer, loadPaidBriefingArchive } from '@/lib/product/paid-briefing-data';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Crypto Briefing Archive | Macro Bias',
  description: 'Public dated crypto readings and full briefings. Pro includes immediate access; signed-in Free accounts can read full articles seven calendar days after publication.',
  alternates: { canonical: '/crypto/briefings' },
};
export default async function CryptoBriefingsPage() {
  const [data, viewer] = await Promise.all([loadPaidBriefingArchive('crypto'), getBriefingViewer()]);
  return <PaidBriefingArchive asset="crypto" data={data} viewer={viewer} />;
}
