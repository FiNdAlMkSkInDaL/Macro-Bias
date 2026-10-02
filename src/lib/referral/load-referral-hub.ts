import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { REFERRAL_LANDING_PATH } from '@/lib/referral/constants';
import { generateReferralCode } from '@/lib/referral/generate-referral-code';
import { getAppUrl } from '@/lib/server-env';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const REWARD_TIERS = [
  { tier: 1, threshold: 3, label: '7-day full briefing unlock' },
  { tier: 2, threshold: 7, label: '1 free month of Pro' },
  { tier: 3, threshold: 15, label: 'Free annual subscription' },
];

export type ReferralReward = {
  tier: number;
  threshold: number;
  label: string;
  earned: boolean;
  fulfilledAt: string | null;
};

export type RecentReferral = {
  referredEmail: string;
  status: string;
  createdAt: string;
};

export type ReferralHub = {
  referralCode: string | null;
  referralLink: string | null;
  landingPath: string;
  verifiedCount: number;
  pendingCount: number;
  totalCount: number;
  rewards: ReferralReward[];
  recentReferrals: RecentReferral[];
};

type SubscriberRow = {
  email: string;
  referral_code: string | null;
  status: string;
  stocks_opted_in: boolean | null;
  crypto_opted_in: boolean | null;
};

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}***@${domain}`;
}

function optedOut(row: SubscriberRow) {
  return row.stocks_opted_in !== true && row.crypto_opted_in !== true;
}

async function assignReferralCode(supabase: SupabaseClient, email: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateReferralCode();
    const { data, error } = await supabase
      .from('free_subscribers')
      .update({ referral_code: code })
      .eq('email', email)
      .is('referral_code', null)
      .select('referral_code')
      .maybeSingle();

    if (!error && data?.referral_code) {
      return data.referral_code as string;
    }

    const existing = await supabase
      .from('free_subscribers')
      .select('referral_code')
      .eq('email', email)
      .maybeSingle();

    if (existing.data?.referral_code) {
      return existing.data.referral_code as string;
    }
  }

  throw new Error('Failed to assign a referral code.');
}

async function ensureProSubscriber(supabase: SupabaseClient, email: string): Promise<SubscriberRow> {
  const code = generateReferralCode();
  const { data, error } = await supabase
    .from('free_subscribers')
    .insert({
      crypto_opted_in: false,
      email,
      referral_code: code,
      status: 'active',
      stocks_opted_in: false,
      tier: 'free',
    })
    .select('email, referral_code, status, stocks_opted_in, crypto_opted_in')
    .maybeSingle();

  if (!error && data) {
    return data as SubscriberRow;
  }

  const existing = await supabase
    .from('free_subscribers')
    .select('email, referral_code, status, stocks_opted_in, crypto_opted_in')
    .eq('email', email)
    .maybeSingle();

  if (existing.data) {
    return existing.data as SubscriberRow;
  }

  throw new Error(error?.message ?? 'Failed to open a referral record.');
}

async function resolveSubscriber(email: string, proOverride: boolean) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('free_subscribers')
    .select('email, referral_code, status, stocks_opted_in, crypto_opted_in')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load referral subscriber: ${error.message}`);
  }

  let subscriber = (data as SubscriberRow | null) ?? null;

  if (!subscriber) {
    if (!proOverride) {
      return null;
    }

    subscriber = await ensureProSubscriber(supabase, email);
  } else if (subscriber.status !== 'active' && proOverride && optedOut(subscriber)) {
    // Morning sends require an opt-in, so an opted-out row can be active without mail.
    const { error: statusError } = await supabase
      .from('free_subscribers')
      .update({ status: 'active' })
      .eq('email', email);

    if (statusError) {
      throw new Error(`Failed to open a referral record: ${statusError.message}`);
    }

    subscriber = { ...subscriber, status: 'active' };
  }

  if (subscriber && proOverride && !subscriber.referral_code) {
    subscriber = { ...subscriber, referral_code: await assignReferralCode(supabase, email) };
  }

  if (!subscriber || (subscriber.status !== 'active' && !proOverride)) {
    return null;
  }

  return subscriber;
}

export async function loadReferralHub(email: string, options: { proOverride: boolean }) {
  const normalized = email.trim().toLowerCase();
  const subscriber = await resolveSubscriber(normalized, options.proOverride);

  if (!subscriber) {
    return { ok: false as const, status: 404, error: 'Subscriber not found.' };
  }

  const supabase = createSupabaseAdminClient();
  const referralCode = subscriber.referral_code;
  const appUrl = getAppUrl().replace(/\/$/, '');
  const referralLink = referralCode ? `${appUrl}${REFERRAL_LANDING_PATH}?ref=${referralCode}` : null;

  const [{ count: verifiedCount }, { count: pendingCount }, { data: fulfilledRewards }, { data: recentReferrals }] =
    await Promise.all([
      supabase
        .from('referrals')
        .select('id', { count: 'exact', head: true })
        .eq('referrer_email', normalized)
        .eq('status', 'verified'),
      supabase
        .from('referrals')
        .select('id', { count: 'exact', head: true })
        .eq('referrer_email', normalized)
        .eq('status', 'pending'),
      supabase.from('referral_rewards').select('reward_tier, fulfilled_at').eq('referrer_email', normalized),
      supabase
        .from('referrals')
        .select('referred_email, status, created_at')
        .eq('referrer_email', normalized)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

  const fulfilledMap = new Map(
    (fulfilledRewards ?? []).map((reward: { reward_tier: number; fulfilled_at: string | null }) => [
      reward.reward_tier,
      reward.fulfilled_at,
    ]),
  );
  const verified = verifiedCount ?? 0;
  const pending = pendingCount ?? 0;

  const hub: ReferralHub = {
    landingPath: REFERRAL_LANDING_PATH,
    pendingCount: pending,
    recentReferrals: (recentReferrals ?? []).map(
      (referral: { referred_email: string; status: string; created_at: string }) => ({
        createdAt: referral.created_at,
        referredEmail: maskEmail(referral.referred_email),
        status: referral.status,
      }),
    ),
    referralCode,
    referralLink,
    rewards: REWARD_TIERS.map(({ tier, threshold, label }) => ({
      earned: verified >= threshold,
      fulfilledAt: fulfilledMap.get(tier) ?? null,
      label,
      threshold,
      tier,
    })),
    totalCount: verified + pending,
    verifiedCount: verified,
  };

  return { ok: true as const, hub };
}
