import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logMarketingEvent } from '@/lib/analytics/server';
import { checkAndFulfillRewards } from '@/lib/referral/rewards';

export async function verifyPendingReferrals(supabase: SupabaseClient) {
  const { data: pendingReferrals, error } = await supabase
    .from('referrals')
    .select('id, referrer_email, referred_email')
    .eq('status', 'pending');

  if (error || !pendingReferrals?.length) return;

  const referredEmails = pendingReferrals.map((r: { referred_email: string }) => r.referred_email);
  const { data: activeSubscribers } = await supabase
    .from('free_subscribers')
    .select('email')
    .in('email', referredEmails)
    .eq('status', 'active');

  const activeSet = new Set(activeSubscribers?.map((s: { email: string }) => s.email) ?? []);
  const toVerify = pendingReferrals.filter((r: { referred_email: string }) => activeSet.has(r.referred_email));

  for (const referral of toVerify) {
    const { error: updateError } = await supabase
      .from('referrals')
      .update({ status: 'verified', verified_at: new Date().toISOString() })
      .eq('id', referral.id);

    if (updateError) {
      console.error('[verify-referrals] Failed to verify referral', referral.id, updateError);
      continue;
    }

    await logMarketingEvent({
      eventName: 'referral_verified',
      pagePath: '/system',
      subscriberEmail: referral.referred_email,
      metadata: {
        referrer_email: referral.referrer_email,
        referred_email: referral.referred_email,
      },
    });

    try {
      await checkAndFulfillRewards(supabase, referral.referrer_email);
    } catch (rewardError) {
      console.error('[verify-referrals] Reward check failed for', referral.referrer_email, rewardError);
    }
  }

  console.log(`[verify-referrals] Verified ${toVerify.length} of ${pendingReferrals.length} pending referrals`);
}
