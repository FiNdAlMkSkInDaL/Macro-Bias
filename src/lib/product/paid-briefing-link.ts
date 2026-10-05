import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { ProductAsset } from './score-access';

export type PaidBriefingLink = { href: string | null; notice: string | null };

/** Check the published session, rather than directing a current reading to a different day's note. */
export async function loadPaidBriefingLink(
  asset: ProductAsset,
  tradeDate: string | null,
  paid: boolean,
): Promise<PaidBriefingLink> {
  if (!paid || !tradeDate || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    return { href: null, notice: null };
  }

  try {
    const admin = createSupabaseAdminClient();
    if (asset === 'stocks') {
      const { data, error } = await admin.from('daily_market_briefings')
        .select('briefing_date, trade_date')
        .eq('briefing_date', tradeDate).eq('trade_date', tradeDate)
        .order('generated_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (data?.briefing_date === tradeDate && data.trade_date === tradeDate) {
        return { href: `/briefings/${data.briefing_date}`, notice: null };
      }
    } else {
      const { data, error } = await admin.from('crypto_daily_briefings')
        .select('trade_date').eq('trade_date', tradeDate)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (data?.trade_date === tradeDate) {
        return { href: `/crypto/briefings/${data.trade_date}`, notice: null };
      }
    }
    return { href: null, notice: 'No full briefing is available for this published session yet.' };
  } catch {
    return { href: null, notice: 'The session briefing could not be checked. You can browse the briefing archive.' };
  }
}
