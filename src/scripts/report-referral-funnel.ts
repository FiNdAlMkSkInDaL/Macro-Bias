import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";

type MarketingEventRow = {
  created_at: string;
  event_name: string;
  metadata: Record<string, unknown> | null;
  page_path: string;
  subscriber_email: string | null;
};

type ReferralRow = {
  created_at: string;
  referred_email: string;
  referrer_email: string;
  status: string;
  verified_at: string | null;
};

type RewardRow = {
  created_at: string;
  fulfilled_at: string | null;
  referrer_email: string;
  reward_tier: number;
  reward_type: string;
};

const EVENT_NAMES = [
  "referral_cta_click",
  "referral_page_viewed",
  "referral_status_loaded",
  "referral_link_copied",
  "referral_share_clicked",
  "referral_link_clicked",
  "referral_attributed",
] as const;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function incrementCount(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function asString(value: unknown, fallback = "unknown") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formatRate(numerator: number, denominator: number) {
  if (!denominator) {
    return "n/a";
  }

  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function filterByDate<T extends { created_at: string }>(rows: T[], since: Date | null) {
  if (!since) {
    return rows;
  }

  return rows.filter((row) => new Date(row.created_at).getTime() >= since.getTime());
}

function sortCounts(map: Map<string, number>) {
  return [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function printCountBlock(title: string, map: Map<string, number>, emptyMessage: string) {
  console.log(`\n${title}`);

  const items = sortCounts(map);

  if (items.length === 0) {
    console.log(`- ${emptyMessage}`);
    return;
  }

  for (const [key, value] of items.slice(0, 10)) {
    console.log(`- ${key}: ${value}`);
  }
}

function printSummary(
  label: string,
  marketingEvents: MarketingEventRow[],
  referrals: ReferralRow[],
  rewards: RewardRow[],
) {
  const ctaClicks = marketingEvents.filter((event) => event.event_name === "referral_cta_click");
  const pageViews = marketingEvents.filter((event) => event.event_name === "referral_page_viewed");
  const statusLoads = marketingEvents.filter((event) => event.event_name === "referral_status_loaded");
  const linkCopies = marketingEvents.filter((event) => event.event_name === "referral_link_copied");
  const shareActions = marketingEvents.filter((event) => event.event_name === "referral_share_clicked");
  const landingClicks = marketingEvents.filter((event) => event.event_name === "referral_link_clicked");
  const attributed = marketingEvents.filter((event) => event.event_name === "referral_attributed");

  const verifiedReferrals = referrals.filter((referral) => referral.status === "verified");
  const pendingReferrals = referrals.filter((referral) => referral.status === "pending");
  const rewardFulfillments = rewards.filter((reward) => Boolean(reward.fulfilled_at));

  const ctaByPage = new Map<string, number>();
  for (const event of ctaClicks) {
    incrementCount(ctaByPage, event.page_path);
  }

  const landingPages = new Map<string, number>();
  for (const event of landingClicks) {
    incrementCount(landingPages, event.page_path);
  }

  const attributedByLanding = new Map<string, number>();
  for (const event of attributed) {
    incrementCount(
      attributedByLanding,
      asString(event.metadata?.landing_page_path ?? event.page_path),
    );
  }

  const shareByMethod = new Map<string, number>();
  for (const event of shareActions) {
    incrementCount(
      shareByMethod,
      asString(event.metadata?.method ?? event.metadata?.label),
    );
  }

  const rewardByTier = new Map<string, number>();
  for (const reward of rewardFulfillments) {
    incrementCount(rewardByTier, `Tier ${reward.reward_tier} (${reward.reward_type})`);
  }

  console.log(`\n=== Referral Funnel Report: ${label} ===`);
  console.log(`- Referral CTA clicks: ${ctaClicks.length}`);
  console.log(`- Referral hub page views: ${pageViews.length}`);
  console.log(`- Referral status loads: ${statusLoads.length}`);
  console.log(`- Referral link copies: ${linkCopies.length}`);
  console.log(`- Share actions: ${shareActions.length}`);
  console.log(`- Referral landing visits: ${landingClicks.length}`);
  console.log(`- Attributed referrals: ${attributed.length}`);
  console.log(`- Pending referrals: ${pendingReferrals.length}`);
  console.log(`- Verified referrals: ${verifiedReferrals.length}`);
  console.log(`- Reward fulfillments: ${rewardFulfillments.length}`);

  console.log("\nConversion rates");
  console.log(`- CTA → status load: ${formatRate(statusLoads.length, ctaClicks.length)}`);
  console.log(`- Status load → link copy: ${formatRate(linkCopies.length, statusLoads.length)}`);
  console.log(`- Landing visit → attributed: ${formatRate(attributed.length, landingClicks.length)}`);
  console.log(`- Attributed → verified: ${formatRate(verifiedReferrals.length, attributed.length)}`);

  printCountBlock("Referral CTA clicks by page", ctaByPage, "No CTA clicks recorded.");
  printCountBlock("Referral landing visits by page", landingPages, "No referral landing visits recorded.");
  printCountBlock("Attributed referrals by landing page", attributedByLanding, "No attributed referrals recorded.");
  printCountBlock("Share methods", shareByMethod, "No share actions recorded.");
  printCountBlock("Rewards by tier", rewardByTier, "No rewards fulfilled yet.");
}

async function main() {
  const [eventsResult, referralsResult, rewardsResult] = await Promise.all([
    supabase
      .from("marketing_event_log")
      .select("event_name, page_path, metadata, created_at, subscriber_email")
      .in("event_name", [...EVENT_NAMES])
      .order("created_at", { ascending: false }),
    supabase
      .from("referrals")
      .select("referrer_email, referred_email, status, created_at, verified_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("referral_rewards")
      .select("referrer_email, reward_tier, reward_type, created_at, fulfilled_at")
      .order("created_at", { ascending: false }),
  ]);

  if (eventsResult.error) {
    throw new Error(`Failed to load marketing events: ${eventsResult.error.message}`);
  }

  if (referralsResult.error) {
    throw new Error(`Failed to load referrals: ${referralsResult.error.message}`);
  }

  if (rewardsResult.error) {
    throw new Error(`Failed to load referral rewards: ${rewardsResult.error.message}`);
  }

  const events = (eventsResult.data ?? []) as MarketingEventRow[];
  const referrals = (referralsResult.data ?? []) as ReferralRow[];
  const rewards = (rewardsResult.data ?? []) as RewardRow[];

  const last30Days = new Date();
  last30Days.setUTCDate(last30Days.getUTCDate() - 30);

  printSummary("Last 30 Days", filterByDate(events, last30Days), filterByDate(referrals, last30Days), filterByDate(rewards, last30Days));
  printSummary("All Time", events, referrals, rewards);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});