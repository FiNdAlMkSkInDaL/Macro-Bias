import { notFound } from 'next/navigation';
import { PaidBriefingDetail } from '@/components/product/PaidBriefingDetail';
import { briefingPageMetadata } from '@/lib/product/briefing-page-metadata';
import { isPaidBriefingDate, loadPaidBriefingDetail } from '@/lib/product/paid-briefing-data';
import { loadPublicBriefingSummary } from '@/lib/product/public-briefing-summary-data';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ date: string }> };
export async function generateMetadata({ params }: Props) {
  return briefingPageMetadata('crypto', (await params).date);
}
export default async function CryptoBriefingPage({ params }: Props) {
  const { date } = await params;
  if (!isPaidBriefingDate(date)) notFound();
  const [data, publicSummary] = await Promise.all([loadPaidBriefingDetail('crypto', date), loadPublicBriefingSummary('crypto', date)]);
  if (!data.metadata && !data.loadError) notFound();
  return <PaidBriefingDetail asset="crypto" date={date} data={data} publicSummary={publicSummary} />;
}
