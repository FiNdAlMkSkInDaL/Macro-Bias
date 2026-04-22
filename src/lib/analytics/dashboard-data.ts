import "server-only";

import type { User } from "@supabase/supabase-js";

import { getPaperTradingDashboardData, type PaperTradingDashboardData } from "@/lib/paper-trading/get-paper-trading-dashboard-data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const FUNNEL_SURFACES = ["/", "/emails", "/today", "/pricing", "/refer"] as const;

type MarketingEventRow = {
  created_at: string;
  event_name: string;
  metadata: Record<string, unknown> | null;
  page_path: string | null;
  subscriber_email: string | null;
  utm_source: string | null;
};

type SubscriberRow = {
  created_at: string | null;
  crypto_opted_in: boolean | null;
  status: string | null;
  stocks_opted_in: boolean | null;
};

type UserRow = {
  subscription_status: string | null;
};

type DeliveryRow = {
  sequence_order: number;
  status: string;
};

type EnrollmentRow = {
  status: string;
};

type ReferralRow = {
  status: string;
};

type RewardRow = {
  fulfilled_at: string | null;
  reward_tier: number;
};

type TopPagesRow = {
  page_path: string | null;
  view_count: unknown;
};

type TopEventsRow = {
  event_name: string | null;
  event_count: unknown;
};

type UtmSourceRow = {
  source_count: unknown;
  utm_source: string | null;
};

type RecentEventRow = {
  created_at: string;
  event_name: string;
  page_path: string | null;
  subscriber_email: string | null;
  utm_source: string | null;
};

type TopReferrerRow = {
  pending_count: unknown;
  referrer_email: string | null;
  verified_count: unknown;
};

type LatestMacroBriefingRow = {
  bias_label: string | null;
  briefing_date: string;
  quant_score: unknown;
};

type LatestCryptoBriefingRow = {
  bias_label: string | null;
  score: unknown;
  trade_date: string;
};

export type AnalyticsSurfaceRow = {
  clicks: number;
  conversionRate: number;
  signups: number;
  surface: string;
  views: number;
};

export type AnalyticsDailySeriesRow = {
  date: string;
  pageViews: number;
  referralShares: number;
  signupRate: number;
  signups: number;
};

export type AnalyticsCtaRow = {
  count: number;
  event: string;
  label: string;
  location: string;
  method: string | null;
};

export type AnalyticsTrafficSourceRow = {
  count: number;
  source: string;
};

export type AnalyticsRecentSignupRow = {
  createdAt: string;
  funnel: string;
  page: string;
  subscriberEmail: string | null;
};

export type AnalyticsReferralShareRow = {
  count: number;
  method: string;
};

export type AnalyticsDripDeliveryRow = {
  cancelled: number;
  clicks: number;
  failed: number;
  opens: number;
  scheduled: number;
  sent: number;
  step: number;
};

export type AnalyticsRecentEventFeedRow = {
  createdAt: string;
  eventName: string;
  pagePath: string;
  source: string | null;
  subscriberEmail: string | null;
};

export type AnalyticsMarketingData = {
  backendSubscriptions30d: number;
  bestSurface: AnalyticsSurfaceRow | null;
  ctaRows: AnalyticsCtaRow[];
  dailySeries14d: AnalyticsDailySeriesRow[];
  missingCoreEvents: string[];
  observedEventNames: string[];
  pageViews30d: number;
  recentEventFeed: AnalyticsRecentEventFeedRow[];
  recentSignups: AnalyticsRecentSignupRow[];
  referralPageViews30d: number;
  referralShareRows: AnalyticsReferralShareRow[];
  referralShares30d: number;
  signups30d: number;
  strongestCta: AnalyticsCtaRow | null;
  surfaceRows: AnalyticsSurfaceRow[];
  topEvents30d: Array<{ count: number; eventName: string }>;
  trafficSources30d: AnalyticsTrafficSourceRow[];
  updatedAt: string;
  weakestSurface: AnalyticsSurfaceRow | null;
  welcomeClicks30d: number;
  welcomeOpens30d: number;
  dripDeliveryRows: AnalyticsDripDeliveryRow[];
};

export type AnalyticsDashboardData = {
  briefings: {
    cryptoCount: number;
    latestCrypto: {
      biasLabel: string | null;
      score: number | null;
      tradeDate: string;
    } | null;
    latestMacro: {
      biasLabel: string | null;
      briefingDate: string;
      quantScore: number | null;
    } | null;
    macroCount: number;
  };
  dripDeliveryStats: Record<number, Record<string, number>>;
  dripEnrollmentCounts: Record<string, number>;
  eventStats: {
    last24h: number;
    last30d: number;
    last7d: number;
  };
  marketing: AnalyticsMarketingData;
  paperTrading: PaperTradingDashboardData;
  recentEvents: AnalyticsRecentEventFeedRow[];
  referralCounts: Record<string, number>;
  rewardStats: {
    byTier: Record<number, number>;
    fulfilled: number;
    total: number;
  };
  subscriberStats: {
    active: number;
    cryptoOptedIn: number;
    inactive: number;
    stocksOptedIn: number;
    total: number;
  };
  topEvents: Array<{ eventCount: number; eventName: string }>;
  topPages: Array<{ pagePath: string; viewCount: number }>;
  topReferrers: Array<{ pendingCount: number; referrerEmail: string | null; verifiedCount: number }>;
  userStats: {
    proUsers: number;
    statusBreakdown: Record<string, number>;
    total: number;
  };
  utmSources: Array<{ source: string; sourceCount: number }>;
};

export const ANALYTICS_ADMIN_EMAIL = "finphillips21@gmail.com";

function getNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function normalizePath(pagePath: string | null | undefined) {
  if (!pagePath) {
    return "/unknown";
  }

  const trimmed = pagePath.trim();

  if (!trimmed) {
    return "/unknown";
  }

  if (trimmed.startsWith("/?") || trimmed.startsWith("/?fbclid") || trimmed.startsWith("/?code")) {
    return "/";
  }

  const [pathOnly] = trimmed.split("?");
  return pathOnly || "/";
}

function getMetadataValue(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((accumulator, item) => {
    const key = getKey(item);
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

function buildDailySeries(events: MarketingEventRow[], days: number): AnalyticsDailySeriesRow[] {
  const dayKeys = Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    return date.toISOString().slice(0, 10);
  });

  const buckets = new Map<string, AnalyticsDailySeriesRow>(
    dayKeys.map((date) => [
      date,
      {
        date,
        pageViews: 0,
        referralShares: 0,
        signupRate: 0,
        signups: 0,
      },
    ]),
  );

  for (const event of events) {
    const date = event.created_at.slice(0, 10);
    const bucket = buckets.get(date);

    if (!bucket) {
      continue;
    }

    if (event.event_name === "page_view") {
      bucket.pageViews += 1;
    }

    if (event.event_name === "email_signup_success") {
      bucket.signups += 1;
    }

    if (event.event_name === "referral_share_clicked") {
      bucket.referralShares += 1;
    }
  }

  return [...buckets.values()].map((row) => ({
    ...row,
    signupRate: row.pageViews > 0 ? (row.signups / row.pageViews) * 100 : 0,
  }));
}

function buildSurfaceRows(events: MarketingEventRow[]): AnalyticsSurfaceRow[] {
  const pageViews = events.filter((event) => event.event_name === "page_view");
  const signups = events.filter((event) => event.event_name === "email_signup_success");
  const ctaClicks = events.filter((event) =>
    ["landing_cta_click", "nav_cta_click", "pricing_cta_click", "referral_cta_click"].includes(
      event.event_name,
    ),
  );

  return FUNNEL_SURFACES.map((surface) => {
    const views = pageViews.filter((event) => normalizePath(event.page_path) === surface).length;
    const surfaceSignups = signups.filter((event) => normalizePath(event.page_path) === surface).length;
    const clicks = ctaClicks.filter((event) => normalizePath(event.page_path) === surface).length;
    const conversionRate = views > 0 ? (surfaceSignups / views) * 100 : 0;

    return {
      clicks,
      conversionRate,
      signups: surfaceSignups,
      surface,
      views,
    };
  });
}

function buildCtaRows(events: MarketingEventRow[]): AnalyticsCtaRow[] {
  const ctaEvents = events.filter((event) =>
    ["landing_cta_click", "nav_cta_click", "pricing_cta_click", "referral_cta_click"].includes(
      event.event_name,
    ),
  );
  const buckets = new Map<
    string,
    { count: number; event: string; label: string; location: string; method: string | null }
  >();

  for (const event of ctaEvents) {
    const label = getMetadataValue(event.metadata, "label") ?? "(no label)";
    const location = getMetadataValue(event.metadata, "location") ?? "(no location)";
    const method = getMetadataValue(event.metadata, "method");
    const key = `${event.event_name}__${label}__${location}__${method ?? ""}`;
    const current = buckets.get(key);

    if (current) {
      current.count += 1;
      continue;
    }

    buckets.set(key, {
      count: 1,
      event: event.event_name,
      label,
      location,
      method,
    });
  }

  return [...buckets.values()].sort((left, right) => right.count - left.count);
}

export async function getAnalyticsAdminUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.email !== ANALYTICS_ADMIN_EMAIL) {
    return null;
  }

  return user;
}

export async function getAnalyticsDashboardData(): Promise<AnalyticsDashboardData> {
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
    marketingEventsRes,
    paperTrading,
  ] = await Promise.all([
    admin.from("free_subscribers").select("status, stocks_opted_in, crypto_opted_in, created_at"),
    admin.from("users").select("subscription_status"),
    admin.from("marketing_event_log").select("id", { count: "exact", head: true }).gte("created_at", oneDayAgo),
    admin.from("marketing_event_log").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    admin.from("marketing_event_log").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgo),
    admin.rpc("get_top_pages", { since: sevenDaysAgo, lim: 15 }),
    admin.rpc("get_top_events", { since: sevenDaysAgo, lim: 15 }),
    admin.rpc("get_utm_sources", { since: thirtyDaysAgo, lim: 15 }),
    admin
      .from("marketing_event_log")
      .select("event_name, page_path, subscriber_email, utm_source, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    admin.from("welcome_email_drip_enrollments").select("status"),
    admin.from("welcome_email_drip_deliveries").select("sequence_order, status"),
    admin.from("referrals").select("status"),
    admin.rpc("get_top_referrers", { lim: 10 }),
    admin.from("referral_rewards").select("reward_tier, fulfilled_at"),
    admin.from("daily_market_briefings").select("id", { count: "exact", head: true }),
    admin.from("crypto_daily_briefings").select("id", { count: "exact", head: true }),
    admin
      .from("daily_market_briefings")
      .select("briefing_date, quant_score, bias_label")
      .order("briefing_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("crypto_daily_briefings")
      .select("trade_date, score, bias_label")
      .order("trade_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("marketing_event_log")
      .select("created_at, event_name, metadata, page_path, subscriber_email, utm_source")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(5000),
    getPaperTradingDashboardData(admin),
  ]);

  const possibleErrors = [
    subscribersRes.error,
    usersRes.error,
    events24hRes.error,
    events7dRes.error,
    events30dRes.error,
    topPagesRes.error,
    topEventsRes.error,
    utmSourcesRes.error,
    recentEventsRes.error,
    dripEnrollmentsRes.error,
    dripDeliveriesRes.error,
    referralsRes.error,
    topReferrersRes.error,
    rewardsRes.error,
    briefingsCountRes.error,
    cryptoBriefingsCountRes.error,
    latestBriefingRes.error,
    latestCryptoBriefingRes.error,
    marketingEventsRes.error,
  ].filter(Boolean);

  if (possibleErrors.length > 0) {
    throw new Error(possibleErrors[0]?.message ?? "Failed to load analytics dashboard data.");
  }

  const subscribers = (subscribersRes.data ?? []) as SubscriberRow[];
  const users = (usersRes.data ?? []) as UserRow[];
  const marketingEvents = (marketingEventsRes.data ?? []) as MarketingEventRow[];
  const dripEnrollments = (dripEnrollmentsRes.data ?? []) as EnrollmentRow[];
  const dripDeliveries = (dripDeliveriesRes.data ?? []) as DeliveryRow[];
  const referrals = (referralsRes.data ?? []) as ReferralRow[];
  const rewards = (rewardsRes.data ?? []) as RewardRow[];
  const topReferrersData = (topReferrersRes.data ?? []) as TopReferrerRow[];
  const recentEventsData = (recentEventsRes.data ?? []) as RecentEventRow[];

  const subscriberStats = {
    total: subscribers.length,
    active: subscribers.filter((subscriber) => subscriber.status === "active").length,
    inactive: subscribers.filter((subscriber) => subscriber.status === "inactive").length,
    stocksOptedIn: subscribers.filter((subscriber) => subscriber.stocks_opted_in).length,
    cryptoOptedIn: subscribers.filter((subscriber) => subscriber.crypto_opted_in).length,
  };

  const userStatusCounts: Record<string, number> = {};

  for (const user of users) {
    const status = user.subscription_status ?? "inactive";
    userStatusCounts[status] = (userStatusCounts[status] ?? 0) + 1;
  }

  const userStats = {
    total: users.length,
    statusBreakdown: userStatusCounts,
    proUsers: users.filter((user) => ["active", "trialing"].includes(user.subscription_status ?? "inactive")).length,
  };

  const eventStats = {
    last24h: events24hRes.count ?? 0,
    last7d: events7dRes.count ?? 0,
    last30d: events30dRes.count ?? 0,
  };

  const dripEnrollmentCounts = countBy(dripEnrollments, (enrollment) => enrollment.status);
  const dripDeliveryStats = dripDeliveries.reduce<Record<number, Record<string, number>>>(
    (accumulator, delivery) => {
      if (!accumulator[delivery.sequence_order]) {
        accumulator[delivery.sequence_order] = {};
      }

      accumulator[delivery.sequence_order][delivery.status] =
        (accumulator[delivery.sequence_order][delivery.status] ?? 0) + 1;
      return accumulator;
    },
    {},
  );
  const referralCounts = countBy(referrals, (referral) => referral.status);
  const rewardStats = {
    total: rewards.length,
    fulfilled: rewards.filter((reward) => reward.fulfilled_at != null).length,
    byTier: rewards.reduce<Record<number, number>>((accumulator, reward) => {
      accumulator[reward.reward_tier] = (accumulator[reward.reward_tier] ?? 0) + 1;
      return accumulator;
    }, {}),
  };

  const pageViews = marketingEvents.filter((event) => event.event_name === "page_view");
  const signups = marketingEvents.filter((event) => event.event_name === "email_signup_success");
  const backendSubscriptions = marketingEvents.filter((event) => event.event_name === "email_subscribed");
  const welcomeOpens = marketingEvents.filter((event) => event.event_name === "welcome_drip_open");
  const welcomeClicks = marketingEvents.filter((event) => event.event_name === "welcome_drip_click");
  const referralShares = marketingEvents.filter((event) => event.event_name === "referral_share_clicked");
  const referralPageViews = marketingEvents.filter((event) => event.event_name === "referral_page_viewed");
  const surfaceRows = buildSurfaceRows(marketingEvents).sort(
    (left, right) => right.signups - left.signups || right.views - left.views,
  );
  const dailySeries14d = buildDailySeries(marketingEvents, 14);
  const ctaRows = buildCtaRows(marketingEvents);
  const referralShareRows = Object.entries(
    countBy(referralShares, (event) => getMetadataValue(event.metadata, "method") ?? "unknown"),
  )
    .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
    .map(([method, count]) => ({
      method,
      count,
    }));
  const dripEngagementByStep = marketingEvents
    .filter((event) => ["welcome_drip_open", "welcome_drip_click"].includes(event.event_name))
    .reduce<Record<string, { clicks: number; opens: number }>>((accumulator, event) => {
      const sequenceOrder = getMetadataValue(event.metadata, "sequence_order") ?? "unknown";

      if (!accumulator[sequenceOrder]) {
        accumulator[sequenceOrder] = { clicks: 0, opens: 0 };
      }

      if (event.event_name === "welcome_drip_open") {
        accumulator[sequenceOrder].opens += 1;
      }

      if (event.event_name === "welcome_drip_click") {
        accumulator[sequenceOrder].clicks += 1;
      }

      return accumulator;
    }, {});
  const dripDeliveryRows = Object.entries(dripDeliveryStats)
    .sort(([leftStep], [rightStep]) => Number(leftStep) - Number(rightStep))
    .map(([step, counts]) => ({
      step: Number(step),
      sent: counts.sent ?? 0,
      scheduled: counts.scheduled ?? 0,
      failed: counts.failed ?? 0,
      cancelled: counts.cancelled ?? 0,
      opens: dripEngagementByStep[step]?.opens ?? 0,
      clicks: dripEngagementByStep[step]?.clicks ?? 0,
    }));
  const observedEventNames = Object.keys(countBy(marketingEvents, (event) => event.event_name)).sort();
  const missingCoreEvents = [
    "welcome_drip_open",
    "welcome_drip_click",
    "referral_share_clicked",
    "today_signup_success",
  ].filter((eventName) => !observedEventNames.includes(eventName));
  const bestSurface =
    [...surfaceRows].sort(
      (left, right) => right.signups - left.signups || right.conversionRate - left.conversionRate,
    )[0] ?? null;
  const weakestSurface =
    [...surfaceRows]
      .filter((row) => row.views > 0)
      .sort(
        (left, right) => left.signups - right.signups || left.conversionRate - right.conversionRate,
      )[0] ?? null;
  const strongestCta = ctaRows[0] ?? null;

  const topPages = ((topPagesRes.data ?? []) as TopPagesRow[]).map((row) => ({
    pagePath: normalizePath(row.page_path),
    viewCount: getNumber(row.view_count),
  }));
  const topEvents = ((topEventsRes.data ?? []) as TopEventsRow[]).map((row) => ({
    eventName: row.event_name ?? "unknown",
    eventCount: getNumber(row.event_count),
  }));
  const utmSources = ((utmSourcesRes.data ?? []) as UtmSourceRow[]).map((row) => ({
    source: row.utm_source ?? "(direct)",
    sourceCount: getNumber(row.source_count),
  }));
  const recentEvents = recentEventsData.map((event) => ({
    createdAt: event.created_at,
    eventName: event.event_name,
    pagePath: normalizePath(event.page_path),
    source: event.utm_source,
    subscriberEmail: event.subscriber_email,
  }));
  const topReferrers = topReferrersData.map((row) => ({
    referrerEmail: row.referrer_email,
    verifiedCount: getNumber(row.verified_count),
    pendingCount: getNumber(row.pending_count),
  }));

  const marketing: AnalyticsMarketingData = {
    pageViews30d: pageViews.length,
    signups30d: signups.length,
    backendSubscriptions30d: backendSubscriptions.length,
    welcomeOpens30d: welcomeOpens.length,
    welcomeClicks30d: welcomeClicks.length,
    referralShares30d: referralShares.length,
    referralPageViews30d: referralPageViews.length,
    surfaceRows,
    dailySeries14d,
    ctaRows,
    trafficSources30d: Object.entries(
      countBy(
        marketingEvents.filter((event) => event.utm_source),
        (event) => event.utm_source ?? "unknown",
      ),
    )
      .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
      .map(([source, count]) => ({
        source,
        count,
      })),
    recentSignups: marketingEvents
      .filter((event) => event.event_name === "email_signup_success")
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, 15)
      .map((event) => ({
        createdAt: event.created_at,
        page: normalizePath(event.page_path),
        funnel: getMetadataValue(event.metadata, "funnel") ?? "generic",
        subscriberEmail: event.subscriber_email,
      })),
    referralShareRows,
    dripDeliveryRows,
    observedEventNames,
    missingCoreEvents,
    bestSurface,
    weakestSurface,
    strongestCta,
    topEvents30d: Object.entries(countBy(marketingEvents, (event) => event.event_name))
      .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
      .slice(0, 20)
      .map(([eventName, count]) => ({
        eventName,
        count,
      })),
    recentEventFeed: marketingEvents.slice(0, 30).map((event) => ({
      createdAt: event.created_at,
      eventName: event.event_name,
      pagePath: normalizePath(event.page_path),
      source: event.utm_source,
      subscriberEmail: event.subscriber_email,
    })),
    updatedAt: now.toISOString(),
  };

  const latestMacro = latestBriefingRes.data as LatestMacroBriefingRow | null;
  const latestCrypto = latestCryptoBriefingRes.data as LatestCryptoBriefingRow | null;

  return {
    subscriberStats,
    userStats,
    eventStats,
    topPages,
    topEvents,
    utmSources,
    recentEvents,
    dripEnrollmentCounts,
    dripDeliveryStats,
    referralCounts,
    topReferrers,
    rewardStats,
    briefings: {
      macroCount: briefingsCountRes.count ?? 0,
      cryptoCount: cryptoBriefingsCountRes.count ?? 0,
      latestMacro: latestMacro
        ? {
            briefingDate: latestMacro.briefing_date,
            quantScore: latestMacro.quant_score == null ? null : getNumber(latestMacro.quant_score),
            biasLabel: latestMacro.bias_label,
          }
        : null,
      latestCrypto: latestCrypto
        ? {
            tradeDate: latestCrypto.trade_date,
            score: latestCrypto.score == null ? null : getNumber(latestCrypto.score),
            biasLabel: latestCrypto.bias_label,
          }
        : null,
    },
    marketing,
    paperTrading,
  };
}
