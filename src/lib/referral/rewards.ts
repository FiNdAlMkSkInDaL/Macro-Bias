import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { Resend } from 'resend';

import { logMarketingEvent } from '@/lib/analytics/server';
import { getAppUrl } from '@/lib/server-env';

const REWARD_TIERS = [
  { tier: 1, threshold: 3, type: 'premium_unlock' as const },
  { tier: 2, threshold: 7, type: 'stripe_coupon' as const },
  { tier: 3, threshold: 15, type: 'stripe_coupon' as const },
] as const;

function getConfiguredFromAddress() {
  const configured = process.env.RESEND_FROM_ADDRESS?.trim();
  return configured || 'Macro Bias <briefing@macro-bias.com>';
}

function getShadowRunRecipient() {
  return process.env.SHADOW_RUN_EMAIL?.trim() || null;
}

export async function checkAndFulfillRewards(
  supabase: SupabaseClient,
  referrerEmail: string,
) {
  const { count } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_email', referrerEmail)
    .eq('status', 'verified');

  if (!count) return;

  const { data: fulfilled } = await supabase
    .from('referral_rewards')
    .select('reward_tier')
    .eq('referrer_email', referrerEmail);

  const fulfilledTiers = new Set(fulfilled?.map((r: { reward_tier: number }) => r.reward_tier) ?? []);

  for (const { tier, threshold, type } of REWARD_TIERS) {
    if (count >= threshold && !fulfilledTiers.has(tier)) {
      await fulfillReward(supabase, referrerEmail, tier, type);
    }
  }
}

async function fulfillReward(
  supabase: SupabaseClient,
  referrerEmail: string,
  tier: number,
  type: 'premium_unlock' | 'stripe_coupon',
) {
  let stripeCouponId: string | null = null;

  if (type === 'premium_unlock') {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await supabase
      .from('free_subscribers')
      .update({ premium_unlock_expires_at: expiresAt.toISOString() })
      .eq('email', referrerEmail);
  }

  if (type === 'stripe_coupon') {
    stripeCouponId = await createAndEmailStripeCoupon(referrerEmail, tier);
  }

  await supabase.from('referral_rewards').insert({
    referrer_email: referrerEmail,
    reward_tier: tier,
    reward_type: type,
    fulfilled_at: new Date().toISOString(),
    stripe_coupon_id: stripeCouponId,
  });

  await logMarketingEvent({
    eventName: 'referral_reward_fulfilled',
    pagePath: '/system',
    subscriberEmail: referrerEmail,
    metadata: { reward_tier: tier, reward_type: type },
  });
}

async function createAndEmailStripeCoupon(referrerEmail: string, tier: number): Promise<string | null> {
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  const resendKey = process.env.RESEND_API_KEY?.trim();

  if (!stripeKey || !resendKey) {
    console.error('[rewards] Missing STRIPE_SECRET_KEY or RESEND_API_KEY for coupon fulfillment');
    return null;
  }

  const stripe = new Stripe(stripeKey);
  const resend = new Resend(resendKey);

  const isAnnual = tier === 3;
  const coupon = await stripe.coupons.create({
    percent_off: 100,
    duration: 'once',
    max_redemptions: 1,
    metadata: {
      referral_tier: String(tier),
      referrer_email: referrerEmail,
    },
  });

  const appUrl = getAppUrl();
  const checkoutUrl = `${appUrl}/api/checkout?plan=${isAnnual ? 'annual' : 'monthly'}&coupon=${coupon.id}`;
  const rewardLabel = isAnnual ? 'Free Annual Subscription' : '1 Free Month of Premium';
  const rewardValue = isAnnual ? '$190' : '$25';

  const recipientEmail = getShadowRunRecipient() ?? referrerEmail;

  await resend.emails.send({
    from: getConfiguredFromAddress(),
    to: recipientEmail,
    subject: `You earned a reward: ${rewardLabel}`,
    html: buildRewardNotificationEmailHtml(referrerEmail, rewardLabel, rewardValue, checkoutUrl, tier),
  });

  return coupon.id;
}

function buildRewardNotificationEmailHtml(
  referrerEmail: string,
  rewardLabel: string,
  rewardValue: string,
  checkoutUrl: string,
  tier: number,
): string {
  const tierDescription = tier === 2
    ? 'Your subscription starts free for 1 month, then continues at $25/mo. Cancel anytime.'
    : 'Your annual subscription starts completely free. No charge for the full year.';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#09090b;font-family:ui-sans-serif,system-ui,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="border:1px solid rgba(56,189,248,0.2);background:#18181b;padding:32px;border-radius:8px;">
      <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:#7dd3fc;">
        [ Referral Reward Unlocked ]
      </p>
      <h1 style="margin:16px 0 0;font-size:24px;font-weight:700;color:#f8fafc;">
        You earned: ${rewardLabel}
      </h1>
      <p style="margin:16px 0 0;font-size:16px;color:#cbd5e1;">
        Your referrals hit the Tier ${tier} milestone. That is a <strong style="color:#f8fafc;">${rewardValue} value</strong>, on us.
      </p>
      <p style="margin:12px 0 0;font-size:14px;color:#94a3b8;">
        ${tierDescription}
      </p>
      <a href="${checkoutUrl}" style="display:inline-block;margin-top:24px;padding:14px 28px;background:#0ea5e9;color:#fff;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;border-radius:8px;">
        Claim Your Reward &rarr;
      </a>
      <p style="margin:24px 0 0;font-size:12px;color:#52525b;">
        This coupon is single-use and tied to your account.
      </p>
    </div>
  </div>
</body>
</html>`;
}
