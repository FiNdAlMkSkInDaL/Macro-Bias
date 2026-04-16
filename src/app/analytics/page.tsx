import { redirect } from 'next/navigation';

import { createSupabaseAdminClient } from '../../lib/supabase/admin';
import { createSupabaseServerClient } from '../../lib/supabase/server';

export const dynamic = 'force-dynamic';

const ADMIN_EMAIL = 'finphillips21@gmail.com';

type TopPage = { page_path: string; view_count: number };
type TopEvent = { event_name: string; event_count: number };
type UtmSource = { utm_source: string; source_count: number };
type TopReferrer = { referrer_email: string; verified_count: number; pending_count: number };
type RecentEvent = {
  event_name: string;
  page_path: string | null;
  subscriber_email: string | null;
  utm_source: string | null;
  created_at: string;
};

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-5 py-4">
      <p className="text-xs font-medium tracking-wider text-zinc-500 uppercase">{label}</p>
      <p className="mt-1 font-[family:var(--font-data)] text-2xl font-semibold text-white">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
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
  rows: (string | number | null)[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.02]">
            {headers.map((h) => (
              <th key={h} className="px-4 py-2.5 text-xs font-medium tracking-wider text-zinc-500 uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-white/[0.02]">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-4 py-2 font-[family:var(--font-data)] text-sm ${j === 0 ? 'text-zinc-300' : 'text-zinc-400'}`}
                >
                  {cell ?? '—'}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="px-4 py-6 text-center text-sm text-zinc-600">
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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
    biasScoresRecentRes,
    cryptoBiasScoresRecentRes,
  ] = await Promise.all([
    admin.from('free_subscribers').select('status, stocks_opted_in, crypto_opted_in'),
    admin.from('users').select('subscription_status'),
    admin.from('marketing_event_log').select('id', { count: 'exact', head: true }).gte('created_at', oneDayAgo),
    admin.from('marketing_event_log').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
    admin.from('marketing_event_log').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo),
    admin.rpc('get_top_pages', { since: sevenDaysAgo, lim: 15 }),
    admin.rpc('get_top_events', { since: sevenDaysAgo, lim: 15 }),
    admin.rpc('get_utm_sources', { since: thirtyDaysAgo, lim: 15 }),
    admin
      .from('marketing_event_log')
      .select('event_name, page_path, subscriber_email, utm_source, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
    admin.from('welcome_email_drip_enrollments').select('status'),
    admin.from('welcome_email_drip_deliveries').select('sequence_order, status'),
    admin.from('referrals').select('status'),
    admin.rpc('get_top_referrers', { lim: 10 }),
    admin.from('referral_rewards').select('reward_tier, reward_type, fulfilled_at'),
    admin.from('daily_market_briefings').select('id', { count: 'exact', head: true }),
    admin.from('crypto_daily_briefings').select('id', { count: 'exact', head: true }),
    admin
      .from('daily_market_briefings')
      .select('briefing_date, quant_score, bias_label')
      .order('briefing_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('crypto_daily_briefings')
      .select('briefing_date, score, bias_label')
      .order('briefing_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('macro_bias_scores')
      .select('trade_date, score, bias_label')
      .order('trade_date', { ascending: false })
      .limit(10),
    admin
      .from('crypto_bias_scores')
      .select('trade_date, score, bias_label')
      .order('trade_date', { ascending: false })
      .limit(10),
  ]);

  // --- Process data ---

  const subscribers = subscribersRes.data ?? [];
  const subscriberStats = {
    total: subscribers.length,
    active: subscribers.filter((s) => s.status === 'active').length,
    inactive: subscribers.filter((s) => s.status === 'inactive').length,
    stocksOptedIn: subscribers.filter((s) => s.stocks_opted_in).length,
    cryptoOptedIn: subscribers.filter((s) => s.crypto_opted_in).length,
  };

  const users = usersRes.data ?? [];
  const userStatusCounts: Record<string, number> = {};
  for (const u of users) {
    const status = u.subscription_status ?? 'inactive';
    userStatusCounts[status] = (userStatusCounts[status] ?? 0) + 1;
  }
  const proUsers = (userStatusCounts['active'] ?? 0) + (userStatusCounts['trialing'] ?? 0);

  const dripEnrollments = dripEnrollmentsRes.data ?? [];
  const dripCounts: Record<string, number> = {};
  for (const e of dripEnrollments) {
    dripCounts[e.status] = (dripCounts[e.status] ?? 0) + 1;
  }

  const dripDeliveries = dripDeliveriesRes.data ?? [];
  const dripByStep: Record<number, Record<string, number>> = {};
  for (const d of dripDeliveries) {
    if (!dripByStep[d.sequence_order]) dripByStep[d.sequence_order] = {};
    dripByStep[d.sequence_order][d.status] = (dripByStep[d.sequence_order][d.status] ?? 0) + 1;
  }

  const referrals = referralsRes.data ?? [];
  const refCounts: Record<string, number> = {};
  for (const r of referrals) {
    refCounts[r.status] = (refCounts[r.status] ?? 0) + 1;
  }

  const rewards = rewardsRes.data ?? [];
  const rewardsByTier: Record<number, number> = {};
  for (const r of rewards) {
    rewardsByTier[r.reward_tier] = (rewardsByTier[r.reward_tier] ?? 0) + 1;
  }

  const topPages = (topPagesRes.data ?? []) as TopPage[];
  const topEvents = (topEventsRes.data ?? []) as TopEvent[];
  const utmSources = (utmSourcesRes.data ?? []) as UtmSource[];
  const topReferrers = (topReferrersRes.data ?? []) as TopReferrer[];
  const recentEvents = (recentEventsRes.data ?? []) as RecentEvent[];
  const recentBiasScores = (biasScoresRecentRes.data ?? []) as { trade_date: string; score: number; bias_label: string }[];
  const recentCryptoBiasScores = (cryptoBiasScoresRecentRes.data ?? []) as { trade_date: string; score: number; bias_label: string }[];

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 sm:px-8 lg:px-10">
      <div className="flex items-center justify-between">
        <h1 className="font-[family:var(--font-heading)] text-2xl font-bold tracking-wide text-white">
          Analytics Dashboard
        </h1>
        <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
          Admin
        </span>
      </div>

      {/* ── Overview KPIs ── */}
      <SectionHeading>Overview</SectionHeading>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Free Subscribers" value={subscriberStats.active} sub={`${subscriberStats.inactive} inactive`} />
        <StatCard label="Stocks Opted In" value={subscriberStats.stocksOptedIn} />
        <StatCard label="Crypto Opted In" value={subscriberStats.cryptoOptedIn} />
        <StatCard label="Pro Users" value={proUsers} sub={`${users.length} total accounts`} />
        <StatCard label="Events (24h)" value={events24hRes.count ?? 0} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Events (7d)" value={events7dRes.count ?? 0} />
        <StatCard label="Events (30d)" value={events30dRes.count ?? 0} />
        <StatCard label="Macro Briefings" value={briefingsCountRes.count ?? 0} sub={latestBriefingRes.data ? `Latest: ${latestBriefingRes.data.briefing_date}` : undefined} />
        <StatCard label="Crypto Briefings" value={cryptoBriefingsCountRes.count ?? 0} sub={latestCryptoBriefingRes.data ? `Latest: ${latestCryptoBriefingRes.data.briefing_date}` : undefined} />
      </div>

      {/* ── Subscription Breakdown ── */}
      <SectionHeading>Subscription Status Breakdown</SectionHeading>
      <DataTable
        headers={['Status', 'Count']}
        rows={Object.entries(userStatusCounts)
          .sort(([, a], [, b]) => b - a)
          .map(([status, count]) => [status, count])}
      />

      {/* ── Top Pages ── */}
      <SectionHeading>Top Pages (7 days)</SectionHeading>
      <DataTable
        headers={['Page', 'Views']}
        rows={topPages.map((p) => [p.page_path, p.view_count])}
      />

      {/* ── Top Events ── */}
      <SectionHeading>Top Events (7 days)</SectionHeading>
      <DataTable
        headers={['Event', 'Count']}
        rows={topEvents.map((e) => [e.event_name, e.event_count])}
      />

      {/* ── UTM Sources ── */}
      <SectionHeading>Traffic Sources (30 days)</SectionHeading>
      <DataTable
        headers={['Source', 'Page Views']}
        rows={utmSources.map((u) => [u.utm_source, u.source_count])}
      />

      {/* ── Recent Events Feed ── */}
      <SectionHeading>Recent Events</SectionHeading>
      <DataTable
        headers={['Time', 'Event', 'Page', 'Email', 'Source']}
        rows={recentEvents.map((e) => [
          formatTimestamp(e.created_at),
          e.event_name,
          e.page_path,
          e.subscriber_email,
          e.utm_source,
        ])}
      />

      {/* ── Email Drip Campaign ── */}
      <SectionHeading>Welcome Drip Campaign</SectionHeading>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active" value={dripCounts['active'] ?? 0} />
        <StatCard label="Completed" value={dripCounts['completed'] ?? 0} />
        <StatCard label="Unsubscribed" value={dripCounts['unsubscribed'] ?? 0} />
        <StatCard label="Paused" value={dripCounts['paused'] ?? 0} />
      </div>
      <h3 className="mb-2 mt-6 text-sm font-medium text-zinc-400">Delivery by Step</h3>
      <DataTable
        headers={['Step', 'Sent', 'Scheduled', 'Failed', 'Cancelled']}
        rows={Object.entries(dripByStep)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([step, counts]) => [
            `Step ${step}`,
            counts['sent'] ?? 0,
            counts['scheduled'] ?? 0,
            counts['failed'] ?? 0,
            counts['cancelled'] ?? 0,
          ])}
      />

      {/* ── Referral Program ── */}
      <SectionHeading>Referral Program</SectionHeading>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Verified" value={refCounts['verified'] ?? 0} />
        <StatCard label="Pending" value={refCounts['pending'] ?? 0} />
        <StatCard label="Rejected" value={refCounts['rejected'] ?? 0} />
        <StatCard label="Rewards Given" value={rewards.length} sub={`T1: ${rewardsByTier[1] ?? 0} · T2: ${rewardsByTier[2] ?? 0} · T3: ${rewardsByTier[3] ?? 0}`} />
      </div>

      {topReferrers.length > 0 && (
        <>
          <h3 className="mb-2 mt-6 text-sm font-medium text-zinc-400">Top Referrers</h3>
          <DataTable
            headers={['Email', 'Verified', 'Pending']}
            rows={topReferrers.map((r) => [r.referrer_email, r.verified_count, r.pending_count])}
          />
        </>
      )}

      {/* ── Recent Bias Scores ── */}
      <SectionHeading>Recent Macro Bias Scores</SectionHeading>
      <DataTable
        headers={['Date', 'Score', 'Label']}
        rows={recentBiasScores.map((s) => [s.trade_date, s.score, s.bias_label])}
      />

      <SectionHeading>Recent Crypto Bias Scores</SectionHeading>
      <DataTable
        headers={['Date', 'Score', 'Label']}
        rows={recentCryptoBiasScores.map((s) => [s.trade_date, s.score, s.bias_label])}
      />

      <div className="mt-16 pb-8 text-center text-xs text-zinc-600">
        Data refreshed at {now.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
      </div>
    </main>
  );
}
