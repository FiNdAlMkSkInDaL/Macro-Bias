import type { Metadata } from 'next';

import { MarketTabs, MemberShell } from '@/components/product/MemberShell';
import { PublishedReadings } from '@/components/product/PublishedReadings';
import { SettledSessionsSection } from '@/components/product/SettledSessions';
import styles from '@/components/product/MemberUI.module.css';
import { loadPublishedReadings } from '@/lib/track-record/published-readings';
import { getSettledCryptoSessions } from '@/lib/track-record/settled-sessions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Crypto track record — Macro Bias',
  description: 'Published Macro Bias crypto scores, dated full briefings and settled BTC session results. Not financial advice.',
};

export default async function CryptoTrackRecordPage() {
  const [readings, sessions] = await Promise.all([
    loadPublishedReadings('crypto'),
    getSettledCryptoSessions().then(
      (rows) => ({ rows, loadError: null }),
      () => ({ rows: [], loadError: 'Settled crypto results are temporarily unavailable. Please try again.' }),
    ),
  ]);
  return (
    <MemberShell title="Crypto track record">
      <MarketTabs asset="crypto" view="history" />
      <p className={styles.muted}>Review published crypto scores, full dated briefings and stored BTC session results.</p>
      <PublishedReadings asset="crypto" data={readings} />
      <SettledSessionsSection asset="Crypto" market="BTC-USD" rows={sessions.rows} loadError={sessions.loadError} />
    </MemberShell>
  );
}
