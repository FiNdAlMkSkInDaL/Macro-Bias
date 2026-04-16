import { NextResponse } from 'next/server';

import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';

const ADMIN_EMAIL = 'finphillips21@gmail.com';

export const dynamic = 'force-dynamic';

async function getAdminUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    return null;
  }

  return user;
}

export async function GET() {
  const user = await getAdminUser();

  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    subscribersRes,
    usersRes,
    events24hRes,
    events7dRes,
    events30dRes,
    topPagesRes,
    topEventsRes,
    utmSourcesRes,
    recentEventsRes,
    dripEnrollmentsRes,
    dripDeliveriesRes,
    referralsRes,
    topReferrersRes,
    rewardsRes,
    briefingsCountRes,
    cryptoBriefingsCountRes,
    latestBriefingRes,
    latestCryptoBriefingRes,
  ] = await Promise.all([
    // Subscribers
    admin.from('free_subscribers').select('status, stocks_opted_in, crypto_opted_in'),

    // Paying users
    admin.from('users').select('subscription_status'),

    // Events counts
    admin.from('marketing_event_log').select('id', { count: 'exact', head: true }).gte('created_at', oneDayAgo),
    admin.from('marketing_event_log').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
    admin.from('marketing_event_log').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo),

    // Top pages (last 7 days)
    admin.rpc('get_top_pages', { since: sevenDaysAgo, lim: 15 }),

    // Top events (last 7 days)
    admin.rpc('get_top_events', { since: sevenDaysAgo, lim: 15 }),

    // UTM sources (last 30 days)
    admin.rpc('get_utm_sources', { since: thirtyDaysAgo, lim: 15 }),

    // Recent events
    admin
      .from('marketing_event_log')
      .select('event_name, page_path, subscriber_email, utm_source, created_at')
      .order('created_at', { ascending: false })
      .limit(30),

    // Drip enrollments
    admin.from('welcome_email_drip_enrollments').select('status'),

    // Drip deliveries
    admin.from('welcome_email_drip_deliveries').select('sequence_order, status'),

    // Referrals
    admin.from('referrals').select('status'),

    // Top referrers
    admin.rpc('get_top_referrers', { lim: 10 }),

    // Rewards
    admin.from('referral_rewards').select('reward_tier, reward_type, fulfilled_at'),

    // Briefings count
    admin.from('daily_market_briefings').select('id', { count: 'exact', head: true }),

    // Crypto briefings count
    admin.from('crypto_daily_briefings').select('id', { count: 'exact', head: true }),

    // Latest briefing
    admin
      .from('daily_market_briefings')
      .select('briefing_date, quant_score, bias_label')
      .order('briefing_date', { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Latest crypto briefing
    admin
      .from('crypto_daily_briefings')
      .select('briefing_date, score, bias_label')
      .order('briefing_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Process subscribers
  const subscribers = subscribersRes.data ?? [];
  const subscriberStats = {
    total: subscribers.length,
    active: subscribers.filter((s) => s.status === 'active').length,
    inactive: subscribers.filter((s) => s.status === 'inactive').length,
    stocksOptedIn: subscribers.filter((s) => s.stocks_opted_in).length,
    cryptoOptedIn: subscribers.filter((s) => s.crypto_opted_in).length,
  };

  // Process paying users
  const users = usersRes.data ?? [];
  const userStatusCounts: Record<string, number> = {};

  for (const u of users) {
    const status = u.subscription_status ?? 'inactive';
    userStatusCounts[status] = (userStatusCounts[status] ?? 0) + 1;
  }

  const userStats = {
    total: users.length,
    statusBreakdown: userStatusCounts,
  };

  // Events
  const eventStats = {
    last24h: events24hRes.count ?? 0,
    last7d: events7dRes.count ?? 0,
    last30d: events30dRes.count ?? 0,
  };

  // Drip enrollments
  const dripEnrollments = dripEnrollmentsRes.data ?? [];
  const dripEnrollmentCounts: Record<string, number> = {};

  for (const e of dripEnrollments) {
    dripEnrollmentCounts[e.status] = (dripEnrollmentCounts[e.status] ?? 0) + 1;
  }

  // Drip deliveries by sequence step and status
  const dripDeliveries = dripDeliveriesRes.data ?? [];
  const dripDeliveryStats: Record<number, Record<string, number>> = {};

  for (const d of dripDeliveries) {
    if (!dripDeliveryStats[d.sequence_order]) {
      dripDeliveryStats[d.sequence_order] = {};
    }

    dripDeliveryStats[d.sequence_order][d.status] =
      (dripDeliveryStats[d.sequence_order][d.status] ?? 0) + 1;
  }

  // Referrals
  const referrals = referralsRes.data ?? [];
  const referralCounts: Record<string, number> = {};

  for (const r of referrals) {
    referralCounts[r.status] = (referralCounts[r.status] ?? 0) + 1;
  }

  // Rewards
  const rewards = rewardsRes.data ?? [];
  const rewardStats = {
    total: rewards.length,
    fulfilled: rewards.filter((r) => r.fulfilled_at != null).length,
    byTier: rewards.reduce(
      (acc, r) => {
        acc[r.reward_tier] = (acc[r.reward_tier] ?? 0) + 1;
        return acc;
      },
      {} as Record<number, number>,
    ),
  };

  return NextResponse.json({
    subscriberStats,
    userStats,
    eventStats,
    topPages: topPagesRes.data ?? [],
    topEvents: topEventsRes.data ?? [],
    utmSources: utmSourcesRes.data ?? [],
    recentEvents: recentEventsRes.data ?? [],
    dripEnrollmentCounts,
    dripDeliveryStats,
    referralCounts,
    topReferrers: topReferrersRes.data ?? [],
    rewardStats,
    briefings: {
      macroCount: briefingsCountRes.count ?? 0,
      cryptoCount: cryptoBriefingsCountRes.count ?? 0,
      latestMacro: latestBriefingRes.data,
      latestCrypto: latestCryptoBriefingRes.data,
    },
  });
}
