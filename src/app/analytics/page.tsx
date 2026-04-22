import { redirect } from 'next/navigation';

import { createSupabaseAdminClient } from '../../lib/supabase/admin';
import { createSupabaseServerClient } from '../../lib/supabase/server';

export const dynamic = 'force-dynamic';

const ADMIN_EMAIL = 'finphillips21@gmail.com';
const FUNNEL_SURFACES = ['/', '/emails', '/today', '/pricing', '/refer'] as const;

type MarketingEventRow = {
  created_at: string;
  event_name: string;
  metadata: Record<string, unknown> | null;
  page_path: string | null;
  subscriber_email: string | null;
  utm_source: string | null;
};

type TopReferrer = {
  pending_count: number;
  referrer_email: string;
  verified_count: number;
};

type SubscriberRow = {
  created_at: string | null;
  crypto_opted_in: boolean | null;
  email: string;
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

type DailySeriesRow = {
  date: string;
  pageViews: number;
  referralShares: number;
  signupRate: number;
  signups: number;
};

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 font-[family:var(--font-data)] text-2xl font-semibold text-white">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 mt-10 font-[family:var(--font-heading)] text-lg font-semibold tracking-wide text-white">
      {children}
    </h2>
  );
}

function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (number | string | null)[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.02]">
            {headers.map((header) => (
              <th
                key={header}
                className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-zinc-500"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.length > 0 ? (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-white/[0.02]">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`px-4 py-2 font-[family:var(--font-data)] text-sm ${
                      cellIndex === 0 ? 'text-zinc-300' : 'text-zinc-400'
                    }`}
                  >
                    {cell ?? '—'}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={headers.length}
                className="px-4 py-6 text-center text-sm text-zinc-600"
              >
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function normalizePath(pagePath: string | null | undefined) {
  if (!pagePath) {
    return '/unknown';
  }

  const trimmed = pagePath.trim();

  if (!trimmed) {
    return '/unknown';
  }

  if (trimmed.startsWith('/?') || trimmed.startsWith('/?fbclid') || trimmed.startsWith('/?code')) {
    return '/';
  }

  const [pathOnly] = trimmed.split('?');
  return pathOnly || '/';
}

function getMetadataValue(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
  });
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatShortDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

function buildDailySeries(events: MarketingEventRow[], days: number): DailySeriesRow[] {
  const dayKeys = Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    return date.toISOString().slice(0, 10);
  });

  const buckets = new Map<string, DailySeriesRow>(
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

    if (event.event_name === 'page_view') {
      bucket.pageViews += 1;
    }

    if (event.event_name === 'email_signup_success') {
      bucket.signups += 1;
    }

    if (event.event_name === 'referral_share_clicked') {
      bucket.referralShares += 1;
    }
  }

  return [...buckets.values()].map((row) => ({
    ...row,
    signupRate: row.pageViews > 0 ? (row.signups / row.pageViews) * 100 : 0,
  }));
}

function buildSurfaceRows(events: MarketingEventRow[]) {
  const pageViews = events.filter((event) => event.event_name === 'page_view');
  const signups = events.filter((event) => event.event_name === 'email_signup_success');
  const ctaClicks = events.filter((event) =>
    ['landing_cta_click', 'nav_cta_click', 'pricing_cta_click', 'referral_cta_click'].includes(
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

function buildCtaRows(events: MarketingEventRow[]) {
  const ctaEvents = events.filter((event) =>
    ['landing_cta_click', 'nav_cta_click', 'pricing_cta_click', 'referral_cta_click'].includes(
      event.event_name,
    ),
  );
  const buckets = new Map<string, { count: number; event: string; label: string; location: string; method: string | null }>();

  for (const event of ctaEvents) {
    const label = getMetadataValue(event.metadata, 'label') ?? '(no label)';
    const location = getMetadataValue(event.metadata, 'location') ?? '(no location)';
    const method = getMetadataValue(event.metadata, 'method');
    const key = `${event.event_name}__${label}__${location}__${method ?? ''}`;
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

  return [...buckets.values()].sort((a, b) => b.count - a.count);
}

function buildRecentSignupRows(events: MarketingEventRow[]) {
  return events
    .filter((event) => event.event_name === 'email_signup_success')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 15)
    .map((event) => [
      formatTimestamp(event.created_at),
      normalizePath(event.page_path),
      getMetadataValue(event.metadata, 'funnel') ?? 'generic',
      event.subscriber_email,
    ]);
}

function TimeSeriesBars({
  label,
  rows,
  valueKey,
  valueFormatter,
}: {
  label: string;
  rows: DailySeriesRow[];
  valueFormatter?: (value: number) => string;
  valueKey: keyof Pick<DailySeriesRow, 'pageViews' | 'referralShares' | 'signupRate' | 'signups'>;
}) {
  const maxValue = Math.max(...rows.map((row) => row[valueKey]), 1);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <div className="mt-4 space-y-3">
        {rows.map((row) => {
          const value = row[valueKey];
          const width = `${Math.max((value / maxValue) * 100, value > 0 ? 6 : 0)}%`;

          return (
            <div key={`${label}-${row.date}`} className="grid grid-cols-[64px_1fr_64px] items-center gap-3">
              <span className="text-xs text-zinc-500">{formatShortDate(row.date)}</span>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-sky-400" style={{ width }} />
              </div>
              <span className="text-right font-[family:var(--font-data)] text-xs text-zinc-300">
                {valueFormatter ? valueFormatter(value) : value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function AnalyticsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    redirect('/');
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    marketingEventsRes,
    subscribersRes,
    usersRes,
    dripEnrollmentsRes,
    dripDeliveriesRes,
    referralsRes,
    rewardsRes,
    topReferrersRes,
  ] = await Promise.all([
    admin
      .from('marketing_event_log')
      .select('created_at, event_name, metadata, page_path, subscriber_email, utm_source')
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(5000),
    admin
      .from('free_subscribers')
      .select('email, status, stocks_opted_in, crypto_opted_in, created_at')
      .order('created_at', { ascending: false }),
    admin.from('users').select('subscription_status'),
    admin.from('welcome_email_drip_enrollments').select('status'),
    admin.from('welcome_email_drip_deliveries').select('sequence_order, status'),
    admin.from('referrals').select('status'),
    admin.from('referral_rewards').select('reward_tier, fulfilled_at'),
    admin.rpc('get_top_referrers', { lim: 10 }),
  ]);

  const marketingEvents = (marketingEventsRes.data ?? []) as MarketingEventRow[];
  const subscribers = (subscribersRes.data ?? []) as SubscriberRow[];
  const users = (usersRes.data ?? []) as UserRow[];
  const dripEnrollments = (dripEnrollmentsRes.data ?? []) as EnrollmentRow[];
  const dripDeliveries = (dripDeliveriesRes.data ?? []) as DeliveryRow[];
  const referrals = (referralsRes.data ?? []) as ReferralRow[];
  const rewards = (rewardsRes.data ?? []) as RewardRow[];
  const topReferrers = (topReferrersRes.data ?? []) as TopReferrer[];

  const pageViews = marketingEvents.filter((event) => event.event_name === 'page_view');
  const signups = marketingEvents.filter((event) => event.event_name === 'email_signup_success');
  const backendSubscriptions = marketingEvents.filter((event) => event.event_name === 'email_subscribed');
  const welcomeOpens = marketingEvents.filter((event) => event.event_name === 'welcome_drip_open');
  const welcomeClicks = marketingEvents.filter((event) => event.event_name === 'welcome_drip_click');
  const referralShares = marketingEvents.filter((event) => event.event_name === 'referral_share_clicked');
  const referralPageViews = marketingEvents.filter((event) => event.event_name === 'referral_page_viewed');
  const topEvents = Object.entries(countBy(marketingEvents, (event) => event.event_name))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);
  const topPages = Object.entries(countBy(pageViews, (event) => normalizePath(event.page_path)))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);
  const trafficSources = Object.entries(
    countBy(
      marketingEvents.filter((event) => event.utm_source),
      (event) => event.utm_source ?? 'unknown',
    ),
  ).sort(([, a], [, b]) => b - a);

  const surfaceRows = buildSurfaceRows(marketingEvents).sort((a, b) => b.signups - a.signups || b.views - a.views);
  const dailySeries = buildDailySeries(marketingEvents, 14);
  const ctaRows = buildCtaRows(marketingEvents);
  const referralShareRows = Object.entries(
    countBy(referralShares, (event) => getMetadataValue(event.metadata, 'method') ?? 'unknown'),
  ).sort(([, a], [, b]) => b - a);
  const dripCounts = countBy(dripEnrollments, (enrollment) => enrollment.status);
  const dripDeliveryByStep = dripDeliveries.reduce<Record<number, Record<string, number>>>(
    (acc, delivery) => {
      if (!acc[delivery.sequence_order]) {
        acc[delivery.sequence_order] = {};
      }

      acc[delivery.sequence_order][delivery.status] =
        (acc[delivery.sequence_order][delivery.status] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const dripEngagementByStep = marketingEvents
    .filter((event) => ['welcome_drip_open', 'welcome_drip_click'].includes(event.event_name))
    .reduce<Record<string, { opens: number; clicks: number }>>((acc, event) => {
      const sequenceOrder = getMetadataValue(event.metadata, 'sequence_order') ?? 'unknown';
      if (!acc[sequenceOrder]) {
        acc[sequenceOrder] = { clicks: 0, opens: 0 };
      }

      if (event.event_name === 'welcome_drip_open') {
        acc[sequenceOrder].opens += 1;
      }

      if (event.event_name === 'welcome_drip_click') {
        acc[sequenceOrder].clicks += 1;
      }

      return acc;
    }, {});

  const subscriberStats = {
    active: subscribers.filter((subscriber) => subscriber.status === 'active').length,
    cryptoOptedIn: subscribers.filter((subscriber) => subscriber.crypto_opted_in).length,
    total: subscribers.length,
  };
  const proUsers = users.filter((userRow) =>
    ['active', 'trialing'].includes(userRow.subscription_status ?? 'inactive'),
  ).length;
  const referralCounts = countBy(referrals, (referral) => referral.status);
  const rewardByTier = countBy(rewards, (reward) => `T${reward.reward_tier}`);
  const observedEventNames = Object.keys(countBy(marketingEvents, (event) => event.event_name)).sort();
  const missingCoreEvents = [
    'welcome_drip_open',
    'welcome_drip_click',
    'referral_share_clicked',
    'today_signup_success',
  ].filter((eventName) => !observedEventNames.includes(eventName));

  const bestSurface = [...surfaceRows].sort((a, b) => b.signups - a.signups || b.conversionRate - a.conversionRate)[0];
  const weakestSurface = [...surfaceRows]
    .filter((row) => row.views > 0)
    .sort((a, b) => a.signups - b.signups || a.conversionRate - b.conversionRate)[0];
  const strongestCta = ctaRows[0];
  const totalReferralShares = referralShares.length;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 sm:px-8 lg:px-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[family:var(--font-heading)] text-2xl font-bold tracking-wide text-white">
            Growth Analytics
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Which surfaces are getting attention, which ones convert into free subscribers,
            and where the referral and lifecycle loops are actually working.
          </p>
        </div>
        <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
          Admin
        </span>
      </div>

      <SectionHeading>At a Glance</SectionHeading>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Free Subscribers" value={subscriberStats.active} sub={`${subscriberStats.total} total`} />
        <StatCard label="Pro Users" value={proUsers} />
        <StatCard label="Page Views (30d)" value={pageViews.length} />
        <StatCard label="Signups (30d)" value={signups.length} sub={`${backendSubscriptions.length} backend confirms`} />
        <StatCard label="Referral Shares" value={totalReferralShares} />
        <StatCard label="Welcome Opens" value={welcomeOpens.length} sub={`${welcomeClicks.length} clicks`} />
      </div>

      <SectionHeading>Operator Read</SectionHeading>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Best Surface Right Now</p>
          <p className="mt-2 text-lg font-semibold text-white">{bestSurface?.surface ?? '—'}</p>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            {bestSurface
              ? `${bestSurface.signups} signups from ${bestSurface.views} views in the last 30 days (${formatPercent(bestSurface.conversionRate)}).`
              : 'No meaningful conversion data yet.'}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Needs Attention</p>
          <p className="mt-2 text-lg font-semibold text-white">{weakestSurface?.surface ?? '—'}</p>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            {weakestSurface
              ? `${weakestSurface.views} views but ${weakestSurface.signups} signups. This surface is getting attention without converting.`
              : 'Not enough traffic to call this yet.'}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Strongest CTA</p>
          <p className="mt-2 text-lg font-semibold text-white">{strongestCta?.label ?? '—'}</p>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            {strongestCta
              ? `${strongestCta.count} clicks from ${strongestCta.location}.`
              : 'No CTA click data yet.'}
          </p>
        </div>
      </div>

      <SectionHeading>Acquisition Surfaces (30 days)</SectionHeading>
      <DataTable
        headers={['Surface', 'Views', 'CTA Clicks', 'Signups', 'Conv. Rate']}
        rows={surfaceRows.map((row) => [
          row.surface,
          row.views,
          row.clicks,
          row.signups,
          row.views > 0 ? formatPercent(row.conversionRate) : '0.0%',
        ])}
      />

      <SectionHeading>Momentum (Last 14 Days)</SectionHeading>
      <div className="grid gap-4 xl:grid-cols-2">
        <TimeSeriesBars label="Daily Page Views" rows={dailySeries} valueKey="pageViews" />
        <TimeSeriesBars label="Daily Signups" rows={dailySeries} valueKey="signups" />
        <TimeSeriesBars
          label="Daily Signup Rate"
          rows={dailySeries}
          valueKey="signupRate"
          valueFormatter={(value) => formatPercent(value)}
        />
        <TimeSeriesBars label="Daily Referral Shares" rows={dailySeries} valueKey="referralShares" />
      </div>

      <SectionHeading>CTA Performance (30 days)</SectionHeading>
      <DataTable
        headers={['Label', 'Event', 'Location', 'Method', 'Clicks']}
        rows={ctaRows.map((row) => [
          row.label,
          row.event,
          row.location,
          row.method,
          row.count,
        ])}
      />

      <SectionHeading>Traffic Sources (30 days)</SectionHeading>
      <DataTable
        headers={['UTM Source', 'Events']}
        rows={trafficSources.map(([source, count]) => [source, count])}
      />

      <SectionHeading>Recent Signups</SectionHeading>
      <DataTable
        headers={['Time', 'Page', 'Funnel', 'Subscriber']}
        rows={buildRecentSignupRows(marketingEvents)}
      />

      <SectionHeading>Referral Loop</SectionHeading>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Referral Page Views" value={referralPageViews.length} />
        <StatCard label="Share Clicks" value={referralShares.length} />
        <StatCard label="Verified Referrals" value={referralCounts.verified ?? 0} />
        <StatCard
          label="Rewards Given"
          value={rewards.length}
          sub={`T1 ${rewardByTier.T1 ?? 0} · T2 ${rewardByTier.T2 ?? 0} · T3 ${rewardByTier.T3 ?? 0}`}
        />
      </div>

      <h3 className="mb-2 mt-6 text-sm font-medium text-zinc-400">Share Methods</h3>
      <DataTable
        headers={['Method', 'Clicks']}
        rows={referralShareRows.map(([method, count]) => [method, count])}
      />

      {topReferrers.length > 0 ? (
        <>
          <h3 className="mb-2 mt-6 text-sm font-medium text-zinc-400">Top Referrers</h3>
          <DataTable
            headers={['Email', 'Verified', 'Pending']}
            rows={topReferrers.map((row) => [row.referrer_email, row.verified_count, row.pending_count])}
          />
        </>
      ) : null}

      <SectionHeading>Welcome Drip</SectionHeading>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active Enrollments" value={dripCounts.active ?? 0} />
        <StatCard label="Completed" value={dripCounts.completed ?? 0} />
        <StatCard label="Opens (30d)" value={welcomeOpens.length} />
        <StatCard label="Clicks (30d)" value={welcomeClicks.length} />
      </div>

      <h3 className="mb-2 mt-6 text-sm font-medium text-zinc-400">Delivery and Engagement by Step</h3>
      <DataTable
        headers={['Step', 'Sent', 'Scheduled', 'Failed', 'Cancelled', 'Opens', 'Clicks']}
        rows={Object.entries(dripDeliveryByStep)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([step, counts]) => [
            `Step ${step}`,
            counts.sent ?? 0,
            counts.scheduled ?? 0,
            counts.failed ?? 0,
            counts.cancelled ?? 0,
            dripEngagementByStep[step]?.opens ?? 0,
            dripEngagementByStep[step]?.clicks ?? 0,
          ])}
      />

      <SectionHeading>Event Taxonomy Audit</SectionHeading>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Observed Events (30 days)</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {observedEventNames.map((eventName) => (
              <span
                key={eventName}
                className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-zinc-300"
              >
                {eventName}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Missing Core Signals</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {missingCoreEvents.length > 0 ? (
              missingCoreEvents.map((eventName) => (
                <span
                  key={eventName}
                  className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300"
                >
                  {eventName}
                </span>
              ))
            ) : (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
                Nothing obvious missing
              </span>
            )}
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            This is the fast audit of what is actually landing in production, not just what exists in code.
          </p>
        </div>
      </div>

      <SectionHeading>Top Events (30 days)</SectionHeading>
      <DataTable
        headers={['Event', 'Count']}
        rows={topEvents.map(([eventName, count]) => [eventName, count])}
      />

      <SectionHeading>Recent Event Feed</SectionHeading>
      <DataTable
        headers={['Time', 'Event', 'Page', 'Email', 'Source']}
        rows={marketingEvents.slice(0, 30).map((event) => [
          formatTimestamp(event.created_at),
          event.event_name,
          normalizePath(event.page_path),
          event.subscriber_email,
          event.utm_source,
        ])}
      />

      <div className="mt-16 pb-8 text-center text-xs text-zinc-600">
        Data refreshed at {now.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
      </div>
    </main>
  );
}
