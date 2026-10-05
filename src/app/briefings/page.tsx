import type { Metadata } from 'next';
import { PaidBriefingArchive } from '@/components/product/PaidBriefingArchive';
import { getBriefingViewer, loadPaidBriefingArchive } from '@/lib/product/paid-briefing-data';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Stock Briefing Archive | Macro Bias',
  description: 'Public dated stock readings and full briefings. Pro includes immediate access; signed-in Free accounts can read full articles seven calendar days after publication.',
  alternates: { canonical: '/briefings' },
  keywords: ['stock market briefing', 'daily macro reading', 'stock briefing archive'],
  openGraph: { type: 'website', siteName: 'Macro Bias', title: 'Stock Briefing Archive | Macro Bias', description: 'Public dated stock readings and full briefings. Pro includes immediate access; signed-in Free accounts can read full articles seven calendar days after publication.', url: '/briefings' },
  twitter: { card: 'summary_large_image', title: 'Stock Briefing Archive | Macro Bias', description: 'Public stock readings, with full articles immediately for Pro and after seven days for signed-in Free accounts.' },
};
export default async function BriefingsPage() {
  const [data, viewer] = await Promise.all([loadPaidBriefingArchive('stocks'), getBriefingViewer()]);
  return <PaidBriefingArchive asset="stocks" data={data} viewer={viewer} />;
}
