import { NextResponse } from 'next/server';

import { REFERRAL_LANDING_PATH } from '@/lib/referral/constants';
import { getAppUrl } from '@/lib/server-env';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const REWARD_TIERS = [
  { tier: 1, threshold: 3, label: '7-day full briefing unlock' },
  { tier: 2, threshold: 7, label: '1 free month of Premium' },
  { tier: 3, threshold: 15, label: 'Free annual subscription' },
];

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}***@${domain}`;
}

// Simple in-memory rate limiter (soft protection for serverless)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get('email')?.trim().toLowerCase();

  if (!email || email.length < 4 || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email parameter is required.' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  // Verify subscriber exists
  const { data: subscriber } = await supabase
    .from('free_subscribers')
    .select('email, referral_code, status')
    .eq('email', email)
    .eq('status', 'active')
    .maybeSingle();

  if (!subscriber) {
    return NextResponse.json({ error: 'Subscriber not found.' }, { status: 404 });
  }

  const referralCode = subscriber.referral_code;
  const appUrl = getAppUrl();
  const referralLink = referralCode ? `${appUrl}${REFERRAL_LANDING_PATH}?ref=${referralCode}` : null;

  // Count referrals
  const { count: verifiedCount } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_email', email)
    .eq('status', 'verified');

  const { count: pendingCount } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_email', email)
    .eq('status', 'pending');

  // Get fulfilled rewards
  const { data: fulfilledRewards } = await supabase
    .from('referral_rewards')
    .select('reward_tier, fulfilled_at')
    .eq('referrer_email', email);

  const fulfilledMap = new Map(
    (fulfilledRewards ?? []).map((r: { reward_tier: number; fulfilled_at: string | null }) => [
      r.reward_tier,
      r.fulfilled_at,
    ]),
  );

  const verified = verifiedCount ?? 0;
  const pending = pendingCount ?? 0;

  const rewards = REWARD_TIERS.map(({ tier, threshold, label }) => ({
    tier,
    threshold,
    label,
    earned: verified >= threshold,
    fulfilledAt: fulfilledMap.get(tier) ?? null,
  }));

  // Get recent referrals (last 20, masked)
  const { data: recentReferrals } = await supabase
    .from('referrals')
    .select('referred_email, status, created_at')
    .eq('referrer_email', email)
    .order('created_at', { ascending: false })
    .limit(20);

  const maskedReferrals = (recentReferrals ?? []).map(
    (r: { referred_email: string; status: string; created_at: string }) => ({
      referredEmail: maskEmail(r.referred_email),
      status: r.status,
      createdAt: r.created_at,
    }),
  );

  return NextResponse.json({
    referralCode,
    referralLink,
    landingPath: REFERRAL_LANDING_PATH,
    verifiedCount: verified,
    pendingCount: pending,
    totalCount: verified + pending,
    rewards,
    recentReferrals: maskedReferrals,
  });
}
