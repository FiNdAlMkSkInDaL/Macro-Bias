import type { Metadata } from 'next';

import { SettledSessions } from '@/components/product/SettledSessions';
import { getSettledCryptoSessions, settledLoadError } from '@/lib/track-record/settled-sessions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Crypto track record — Macro Bias',
  description:
    'Settled next-session BTC open-to-close results for stored Macro Bias crypto scores. Not financial advice.',
};

export default async function CryptoTrackRecordPage() {
  try {
    const rows = await getSettledCryptoSessions();
    return <SettledSessions asset="Crypto" market="BTC-USD" rows={rows} />;
  } catch (error) {
    return (
      <SettledSessions
        asset="Crypto"
        market="BTC-USD"
        rows={[]}
        loadError={settledLoadError(error, 'crypto_bias_scores')}
      />
    );
  }
}
