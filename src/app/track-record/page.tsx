import type { Metadata } from 'next';

import { SettledSessions } from '@/components/product/SettledSessions';
import { getSettledStockSessions } from '@/lib/track-record/settled-sessions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Stock track record — Macro Bias',
  description:
    'Settled next-session SPY open-to-close results for stored Macro Bias scores. Not financial advice.',
};

export default async function TrackRecordPage() {
  const rows = await getSettledStockSessions();
  return <SettledSessions asset="Stocks" market="SPY" rows={rows} />;
}
