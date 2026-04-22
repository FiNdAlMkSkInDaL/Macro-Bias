import type { ReactNode } from "react";

import { redirect } from "next/navigation";

import AgentEquityChart from "@/components/analytics/AgentEquityChart";
import {
  getAnalyticsAdminUser,
  getAnalyticsDashboardData,
} from "@/lib/analytics/dashboard-data";

export const dynamic = "force-dynamic";

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
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
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
                      cellIndex === 0 ? "text-zinc-300" : "text-zinc-400"
                    }`}
                  >
                    {cell ?? "-"}
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

function TimeSeriesBars({
  label,
  rows,
  valueKey,
  valueFormatter,
}: {
  label: string;
  rows: Array<{
    date: string;
    pageViews: number;
    referralShares: number;
    signupRate: number;
    signups: number;
  }>;
  valueFormatter?: (value: number) => string;
  valueKey: "pageViews" | "referralShares" | "signupRate" | "signups";
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

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  });
}

function formatShortDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatWeight(value: number) {
  return formatPercent(value * 100);
}

function formatCurrency(value: number, maximumFractionDigits = 0) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: maximumFractionDigits,
    maximumFractionDigits,
  });
}

function formatQuantity(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export default async function AnalyticsPage() {
  const user = await getAnalyticsAdminUser();

  if (!user) {
    redirect("/");
  }

  const data = await getAnalyticsDashboardData();
  const { marketing, paperTrading } = data;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 sm:px-8 lg:px-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[family:var(--font-heading)] text-2xl font-bold tracking-wide text-white">
            Growth Analytics
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Which surfaces are getting attention, which ones convert into free subscribers,
            and how the paper trading agent is performing inside the admin stack.
          </p>
        </div>
        <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
          Admin
        </span>
      </div>

      <SectionHeading>At a Glance</SectionHeading>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Free Subscribers"
          value={data.subscriberStats.active}
          sub={`${data.subscriberStats.total} total`}
        />
        <StatCard label="Pro Users" value={data.userStats.proUsers} />
        <StatCard label="Page Views (30d)" value={marketing.pageViews30d} />
        <StatCard
          label="Signups (30d)"
          value={marketing.signups30d}
          sub={`${marketing.backendSubscriptions30d} backend confirms`}
        />
        <StatCard label="Referral Shares" value={marketing.referralShares30d} />
        <StatCard
          label="Welcome Opens"
          value={marketing.welcomeOpens30d}
          sub={`${marketing.welcomeClicks30d} clicks`}
        />
      </div>

      <SectionHeading>Agent Performance</SectionHeading>
      {paperTrading.hasData ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Paper Equity"
              value={formatCurrency(paperTrading.currentPortfolio.totalEquity)}
              sub={
                paperTrading.currentPortfolio.briefingDate
                  ? `Snapshot ${formatShortDate(paperTrading.currentPortfolio.briefingDate)}`
                  : undefined
              }
            />
            <StatCard
              label="Total Return"
              value={formatSignedPercent(paperTrading.currentPortfolio.totalReturnPct)}
              sub={`${paperTrading.sessionCount} sessions tracked`}
            />
            <StatCard
              label="Cash Weight"
              value={formatWeight(paperTrading.currentPortfolio.cashWeight)}
              sub={formatCurrency(paperTrading.currentPortfolio.cashBalance)}
            />
            <StatCard
              label="SPY Weight"
              value={formatWeight(paperTrading.currentPortfolio.spyWeight)}
              sub={
                paperTrading.currentPortfolio.positionQuantity > 0
                  ? `${formatQuantity(paperTrading.currentPortfolio.positionQuantity)} shares`
                  : "Flat"
              }
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.45fr_0.55fr]">
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
              <p className="text-xs uppercase tracking-wider text-zinc-500">Equity Curve</p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                Simulated portfolio performance since launch, marked to the stored SPY close used by the paper-trading agent.
              </p>
              <div className="mt-4">
                <AgentEquityChart data={paperTrading.equityCurve} />
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
                <p className="text-xs uppercase tracking-wider text-zinc-500">Open Position</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-xs text-zinc-500">SPY Position</p>
                    <p className="mt-1 font-[family:var(--font-data)] text-lg text-white">
                      {paperTrading.currentPortfolio.positionQuantity > 0
                        ? `${formatQuantity(paperTrading.currentPortfolio.positionQuantity)} shares`
                        : "No open SPY position"}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-zinc-500">Mark Price</p>
                      <p className="mt-1 font-[family:var(--font-data)] text-zinc-200">
                        {formatCurrency(paperTrading.currentPortfolio.markPrice, 2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Market Value</p>
                      <p className="mt-1 font-[family:var(--font-data)] text-zinc-200">
                        {formatCurrency(paperTrading.currentPortfolio.positionMarketValue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Average Cost</p>
                      <p className="mt-1 font-[family:var(--font-data)] text-zinc-200">
                        {paperTrading.currentPortfolio.positionAvgCost != null
                          ? formatCurrency(paperTrading.currentPortfolio.positionAvgCost, 2)
                          : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Pricing Date</p>
                      <p className="mt-1 font-[family:var(--font-data)] text-zinc-200">
                        {paperTrading.currentPortfolio.pricingTradeDate
                          ? formatShortDate(paperTrading.currentPortfolio.pricingTradeDate)
                          : "-"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {paperTrading.latestRun ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
                  <p className="text-xs uppercase tracking-wider text-zinc-500">Latest Agent Read</p>
                  <p className="mt-3 text-sm leading-6 text-zinc-300">
                    {paperTrading.latestRun.reasoningSummary}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {paperTrading.latestRun.riskFlags.length > 0 ? (
                      paperTrading.latestRun.riskFlags.map((flag) => (
                        <span
                          key={flag}
                          className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-zinc-300"
                        >
                          {flag}
                        </span>
                      ))
                    ) : (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
                        No active risk flags
                      </span>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <h3 className="mb-2 mt-6 text-sm font-medium text-zinc-400">Latest Run / Execution</h3>
          <DataTable
            headers={["Briefing", "Decision", "Conviction", "Target SPY", "Execution", "Price", "Notional", "Status"]}
            rows={
              paperTrading.latestRun
                ? [
                    [
                      formatShortDate(paperTrading.latestRun.briefingDate),
                      paperTrading.latestRun.decision,
                      paperTrading.latestRun.convictionScore,
                      formatWeight(paperTrading.latestRun.targetSpyWeight),
                      paperTrading.latestExecution
                        ? `${paperTrading.latestExecution.side} ${formatQuantity(paperTrading.latestExecution.quantity)}`
                        : "No rebalance",
                      paperTrading.latestExecution
                        ? formatCurrency(paperTrading.latestExecution.price, 2)
                        : "-",
                      paperTrading.latestExecution
                        ? formatCurrency(paperTrading.latestExecution.notional)
                        : "-",
                      paperTrading.latestRun.status,
                    ],
                  ]
                : []
            }
          />
        </>
      ) : (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm text-zinc-300">No paper trading runs have been logged yet.</p>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Once the cron starts writing daily snapshots, the equity curve and latest run details will appear here automatically.
          </p>
        </div>
      )}

      <SectionHeading>Operator Read</SectionHeading>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Best Surface Right Now</p>
          <p className="mt-2 text-lg font-semibold text-white">{marketing.bestSurface?.surface ?? "-"}</p>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            {marketing.bestSurface
              ? `${marketing.bestSurface.signups} signups from ${marketing.bestSurface.views} views in the last 30 days (${formatPercent(marketing.bestSurface.conversionRate)}).`
              : "No meaningful conversion data yet."}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Needs Attention</p>
          <p className="mt-2 text-lg font-semibold text-white">{marketing.weakestSurface?.surface ?? "-"}</p>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            {marketing.weakestSurface
              ? `${marketing.weakestSurface.views} views but ${marketing.weakestSurface.signups} signups. This surface is getting attention without converting.`
              : "Not enough traffic to call this yet."}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Strongest CTA</p>
          <p className="mt-2 text-lg font-semibold text-white">{marketing.strongestCta?.label ?? "-"}</p>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            {marketing.strongestCta
              ? `${marketing.strongestCta.count} clicks from ${marketing.strongestCta.location}.`
              : "No CTA click data yet."}
          </p>
        </div>
      </div>

      <SectionHeading>Acquisition Surfaces (30 days)</SectionHeading>
      <DataTable
        headers={["Surface", "Views", "CTA Clicks", "Signups", "Conv. Rate"]}
        rows={marketing.surfaceRows.map((row) => [
          row.surface,
          row.views,
          row.clicks,
          row.signups,
          row.views > 0 ? formatPercent(row.conversionRate) : "0.0%",
        ])}
      />

      <SectionHeading>Momentum (Last 14 Days)</SectionHeading>
      <div className="grid gap-4 xl:grid-cols-2">
        <TimeSeriesBars label="Daily Page Views" rows={marketing.dailySeries14d} valueKey="pageViews" />
        <TimeSeriesBars label="Daily Signups" rows={marketing.dailySeries14d} valueKey="signups" />
        <TimeSeriesBars
          label="Daily Signup Rate"
          rows={marketing.dailySeries14d}
          valueKey="signupRate"
          valueFormatter={(value) => formatPercent(value)}
        />
        <TimeSeriesBars
          label="Daily Referral Shares"
          rows={marketing.dailySeries14d}
          valueKey="referralShares"
        />
      </div>

      <SectionHeading>CTA Performance (30 days)</SectionHeading>
      <DataTable
        headers={["Label", "Event", "Location", "Method", "Clicks"]}
        rows={marketing.ctaRows.map((row) => [
          row.label,
          row.event,
          row.location,
          row.method,
          row.count,
        ])}
      />

      <SectionHeading>Traffic Sources (30 days)</SectionHeading>
      <DataTable
        headers={["UTM Source", "Events"]}
        rows={marketing.trafficSources30d.map((row) => [row.source, row.count])}
      />

      <SectionHeading>Recent Signups</SectionHeading>
      <DataTable
        headers={["Time", "Page", "Funnel", "Subscriber"]}
        rows={marketing.recentSignups.map((row) => [
          formatTimestamp(row.createdAt),
          row.page,
          row.funnel,
          row.subscriberEmail,
        ])}
      />

      <SectionHeading>Referral Loop</SectionHeading>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Referral Page Views" value={marketing.referralPageViews30d} />
        <StatCard label="Share Clicks" value={marketing.referralShares30d} />
        <StatCard label="Verified Referrals" value={data.referralCounts.verified ?? 0} />
        <StatCard
          label="Rewards Given"
          value={data.rewardStats.total}
          sub={`T1 ${data.rewardStats.byTier[1] ?? 0} | T2 ${data.rewardStats.byTier[2] ?? 0} | T3 ${data.rewardStats.byTier[3] ?? 0}`}
        />
      </div>

      <h3 className="mb-2 mt-6 text-sm font-medium text-zinc-400">Share Methods</h3>
      <DataTable
        headers={["Method", "Clicks"]}
        rows={marketing.referralShareRows.map((row) => [row.method, row.count])}
      />

      {data.topReferrers.length > 0 ? (
        <>
          <h3 className="mb-2 mt-6 text-sm font-medium text-zinc-400">Top Referrers</h3>
          <DataTable
            headers={["Email", "Verified", "Pending"]}
            rows={data.topReferrers.map((row) => [
              row.referrerEmail,
              row.verifiedCount,
              row.pendingCount,
            ])}
          />
        </>
      ) : null}

      <SectionHeading>Welcome Drip</SectionHeading>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active Enrollments" value={data.dripEnrollmentCounts.active ?? 0} />
        <StatCard label="Completed" value={data.dripEnrollmentCounts.completed ?? 0} />
        <StatCard label="Opens (30d)" value={marketing.welcomeOpens30d} />
        <StatCard label="Clicks (30d)" value={marketing.welcomeClicks30d} />
      </div>

      <h3 className="mb-2 mt-6 text-sm font-medium text-zinc-400">Delivery and Engagement by Step</h3>
      <DataTable
        headers={["Step", "Sent", "Scheduled", "Failed", "Cancelled", "Opens", "Clicks"]}
        rows={marketing.dripDeliveryRows.map((row) => [
          `Step ${row.step}`,
          row.sent,
          row.scheduled,
          row.failed,
          row.cancelled,
          row.opens,
          row.clicks,
        ])}
      />

      <SectionHeading>Event Taxonomy Audit</SectionHeading>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Observed Events (30 days)</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {marketing.observedEventNames.map((eventName) => (
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
            {marketing.missingCoreEvents.length > 0 ? (
              marketing.missingCoreEvents.map((eventName) => (
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
        headers={["Event", "Count"]}
        rows={marketing.topEvents30d.map((row) => [row.eventName, row.count])}
      />

      <SectionHeading>Recent Event Feed</SectionHeading>
      <DataTable
        headers={["Time", "Event", "Page", "Email", "Source"]}
        rows={marketing.recentEventFeed.map((event) => [
          formatTimestamp(event.createdAt),
          event.eventName,
          event.pagePath,
          event.subscriberEmail,
          event.source,
        ])}
      />

      <div className="mt-16 pb-8 text-center text-xs text-zinc-600">
        Data refreshed at{" "}
        {new Date(marketing.updatedAt).toLocaleString("en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </div>
    </main>
  );
}
