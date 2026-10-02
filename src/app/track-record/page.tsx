import type { Metadata } from 'next';

import { MarketTabs, MemberShell } from '@/components/product/MemberShell';
import { PublishedReadings } from '@/components/product/PublishedReadings';
import styles from '@/components/product/MemberUI.module.css';
import { loadPublishedReadings } from '@/lib/track-record/published-readings';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = {
  title: 'Stock track record — Macro Bias',
  description: 'Published Macro Bias stock scores and their dated full briefings. Not financial advice.',
};

export default async function TrackRecordPage() {
  const readings = await loadPublishedReadings('stocks');
  return (
    <MemberShell title="Stock track record">
      <MarketTabs asset="stocks" view="history" />
      <p className={styles.muted}>Review published stock scores and open their full dated briefings.</p>
      <PublishedReadings asset="stocks" data={readings} />
      <p className={styles.muted}>Not financial advice.</p>
    </MemberShell>
  );
}
