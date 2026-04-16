import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function hr(title: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}`);
}

async function main() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // ── FREE SUBSCRIBERS ──
  hr("FREE SUBSCRIBERS");
  const { data: subs } = await supabase.from("free_subscribers").select("*");
  const allSubs = subs ?? [];
  const activeSubs = allSubs.filter((s) => s.status === "active");
  const inactiveSubs = allSubs.filter((s) => s.status === "inactive");
  console.log(`Total: ${allSubs.length}`);
  console.log(`Active: ${activeSubs.length}`);
  console.log(`Inactive: ${inactiveSubs.length}`);
  console.log(`Stocks opted in: ${allSubs.filter((s) => s.stocks_opted_in).length}`);
  console.log(`Crypto opted in: ${allSubs.filter((s) => s.crypto_opted_in).length}`);
  console.log(`With referral code: ${allSubs.filter((s) => s.referral_code).length}`);
  console.log(`Referred by someone: ${allSubs.filter((s) => s.referred_by).length}`);
  console.log(`Premium unlock active: ${allSubs.filter((s) => s.premium_unlock_expires_at && new Date(s.premium_unlock_expires_at) > now).length}`);

  // Sign-up dates
  const subsByDate: Record<string, number> = {};
  for (const s of allSubs) {
    const d = s.created_at?.slice(0, 10);
    if (d) subsByDate[d] = (subsByDate[d] ?? 0) + 1;
  }
  console.log("\nSign-ups by date:");
  Object.entries(subsByDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, count]) => console.log(`  ${date}: ${count}`));

  // ── PAYING USERS ──
  hr("PAYING USERS");
  const { data: users } = await supabase.from("users").select("*");
  const allUsers = users ?? [];
  console.log(`Total auth users: ${allUsers.length}`);
  const statusCounts: Record<string, number> = {};
  for (const u of allUsers) {
    const s = u.subscription_status ?? "inactive";
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }
  Object.entries(statusCounts)
    .sort(([, a], [, b]) => b - a)
    .forEach(([status, count]) => console.log(`  ${status}: ${count}`));

  // ── MARKETING EVENTS ──
  hr("MARKETING EVENTS");
  const { count: total24h } = await supabase
    .from("marketing_event_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", oneDayAgo);
  const { count: total7d } = await supabase
    .from("marketing_event_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", sevenDaysAgo);
  const { count: total30d } = await supabase
    .from("marketing_event_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", thirtyDaysAgo);
  const { count: totalAll } = await supabase
    .from("marketing_event_log")
    .select("id", { count: "exact", head: true });
  console.log(`Events (24h): ${total24h}`);
  console.log(`Events (7d): ${total7d}`);
  console.log(`Events (30d): ${total30d}`);
  console.log(`Events (all time): ${totalAll}`);

  // Top events (all time)
  const { data: allEvents } = await supabase
    .from("marketing_event_log")
    .select("event_name, page_path, utm_source, subscriber_email, created_at")
    .order("created_at", { ascending: false })
    .limit(2000);
  const eventsByName: Record<string, number> = {};
  for (const e of allEvents ?? []) {
    eventsByName[e.event_name] = (eventsByName[e.event_name] ?? 0) + 1;
  }
  console.log("\nTop events (last 2000):");
  Object.entries(eventsByName)
    .sort(([, a], [, b]) => b - a)
    .forEach(([name, count]) => console.log(`  ${name}: ${count}`));

  // Top pages
  const pageViews = (allEvents ?? []).filter((e) => e.event_name === "page_view");
  const pagesByPath: Record<string, number> = {};
  for (const e of pageViews) {
    if (e.page_path) pagesByPath[e.page_path] = (pagesByPath[e.page_path] ?? 0) + 1;
  }
  console.log("\nTop pages (from recent page_views):");
  Object.entries(pagesByPath)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .forEach(([path, count]) => console.log(`  ${path}: ${count}`));

  // UTM sources
  const utmCounts: Record<string, number> = {};
  for (const e of pageViews) {
    const src = e.utm_source ?? "(direct)";
    utmCounts[src] = (utmCounts[src] ?? 0) + 1;
  }
  console.log("\nTraffic sources:");
  Object.entries(utmCounts)
    .sort(([, a], [, b]) => b - a)
    .forEach(([src, count]) => console.log(`  ${src}: ${count}`));

  // Events by day
  const eventsByDay: Record<string, number> = {};
  for (const e of allEvents ?? []) {
    const d = e.created_at?.slice(0, 10);
    if (d) eventsByDay[d] = (eventsByDay[d] ?? 0) + 1;
  }
  console.log("\nEvents by day (recent):");
  Object.entries(eventsByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .forEach(([date, count]) => console.log(`  ${date}: ${count}`));

  // Subscription events
  const subEvents = (allEvents ?? []).filter((e) => e.event_name === "email_subscribed");
  console.log(`\nSubscription events tracked: ${subEvents.length}`);
  const subEventsByDay: Record<string, number> = {};
  for (const e of subEvents) {
    const d = e.created_at?.slice(0, 10);
    if (d) subEventsByDay[d] = (subEventsByDay[d] ?? 0) + 1;
  }
  if (Object.keys(subEventsByDay).length > 0) {
    console.log("Subscriptions by day:");
    Object.entries(subEventsByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([date, count]) => console.log(`  ${date}: ${count}`));
  }

  // Recent 15 events
  console.log("\nLast 15 events:");
  for (const e of (allEvents ?? []).slice(0, 15)) {
    console.log(
      `  ${e.created_at?.slice(0, 16)} | ${e.event_name.padEnd(24)} | ${(e.page_path ?? "").padEnd(25)} | ${e.subscriber_email ?? ""} | ${e.utm_source ?? ""}`
    );
  }

  // ── WELCOME DRIP ──
  hr("WELCOME EMAIL DRIP");
  const { data: dripEnrollments } = await supabase.from("welcome_email_drip_enrollments").select("*");
  const enrollments = dripEnrollments ?? [];
  const dripCounts: Record<string, number> = {};
  for (const e of enrollments) {
    dripCounts[e.status] = (dripCounts[e.status] ?? 0) + 1;
  }
  console.log(`Total enrollments: ${enrollments.length}`);
  Object.entries(dripCounts).forEach(([s, c]) => console.log(`  ${s}: ${c}`));

  const { data: dripDeliveries } = await supabase.from("welcome_email_drip_deliveries").select("*");
  const deliveries = dripDeliveries ?? [];
  console.log(`\nTotal deliveries: ${deliveries.length}`);
  const byStep: Record<number, Record<string, number>> = {};
  for (const d of deliveries) {
    if (!byStep[d.sequence_order]) byStep[d.sequence_order] = {};
    byStep[d.sequence_order][d.status] = (byStep[d.sequence_order][d.status] ?? 0) + 1;
  }
  for (const [step, counts] of Object.entries(byStep).sort(([a], [b]) => Number(a) - Number(b))) {
    console.log(`  Step ${step}: ${JSON.stringify(counts)}`);
  }

  // ── REFERRAL PROGRAM ──
  hr("REFERRAL PROGRAM");
  const { data: referrals } = await supabase.from("referrals").select("*").order("created_at", { ascending: false });
  const allRefs = referrals ?? [];
  const refCounts: Record<string, number> = {};
  for (const r of allRefs) {
    refCounts[r.status] = (refCounts[r.status] ?? 0) + 1;
  }
  console.log(`Total referrals: ${allRefs.length}`);
  Object.entries(refCounts).forEach(([s, c]) => console.log(`  ${s}: ${c}`));

  if (allRefs.length > 0) {
    // Top referrers
    const refByEmail: Record<string, { verified: number; pending: number }> = {};
    for (const r of allRefs) {
      if (!refByEmail[r.referrer_email]) refByEmail[r.referrer_email] = { verified: 0, pending: 0 };
      if (r.status === "verified") refByEmail[r.referrer_email].verified++;
      if (r.status === "pending") refByEmail[r.referrer_email].pending++;
    }
    console.log("\nTop referrers:");
    Object.entries(refByEmail)
      .sort(([, a], [, b]) => b.verified - a.verified || b.pending - a.pending)
      .slice(0, 10)
      .forEach(([email, counts]) => console.log(`  ${email}: ${counts.verified} verified, ${counts.pending} pending`));
  }

  const { data: rewards } = await supabase.from("referral_rewards").select("*");
  const allRewards = rewards ?? [];
  console.log(`\nRewards: ${allRewards.length}`);
  for (const r of allRewards) {
    console.log(`  Tier ${r.reward_tier} (${r.reward_type}) → ${r.referrer_email} | fulfilled: ${r.fulfilled_at ?? "no"}`);
  }

  // ── BIAS SCORES ──
  hr("MACRO BIAS SCORES (last 10)");
  const { data: macroScores } = await supabase
    .from("macro_bias_scores")
    .select("trade_date, score, bias_label")
    .order("trade_date", { ascending: false })
    .limit(10);
  for (const s of macroScores ?? []) {
    console.log(`  ${s.trade_date}: ${String(s.score).padStart(4)} → ${s.bias_label}`);
  }

  hr("CRYPTO BIAS SCORES (last 10)");
  const { data: cryptoScores } = await supabase
    .from("crypto_bias_scores")
    .select("trade_date, score, bias_label")
    .order("trade_date", { ascending: false })
    .limit(10);
  for (const s of cryptoScores ?? []) {
    console.log(`  ${s.trade_date}: ${String(s.score).padStart(4)} → ${s.bias_label}`);
  }

  // ── BRIEFINGS ──
  hr("BRIEFINGS");
  const { count: macroCount } = await supabase
    .from("daily_market_briefings")
    .select("id", { count: "exact", head: true });
  const { count: cryptoCount } = await supabase
    .from("crypto_daily_briefings")
    .select("id", { count: "exact", head: true });
  console.log(`Macro briefings: ${macroCount}`);
  console.log(`Crypto briefings: ${cryptoCount}`);

  const { data: latestMacro } = await supabase
    .from("daily_market_briefings")
    .select("briefing_date, quant_score, bias_label, generation_method")
    .order("briefing_date", { ascending: false })
    .limit(3);
  console.log("\nLatest macro briefings:");
  for (const b of latestMacro ?? []) {
    console.log(`  ${b.briefing_date}: score=${b.quant_score} label=${b.bias_label} method=${b.generation_method}`);
  }

  const { data: latestCrypto } = await supabase
    .from("crypto_daily_briefings")
    .select("briefing_date, score, bias_label")
    .order("briefing_date", { ascending: false })
    .limit(3);
  console.log("\nLatest crypto briefings:");
  for (const b of latestCrypto ?? []) {
    console.log(`  ${b.briefing_date}: score=${b.score} label=${b.bias_label}`);
  }

  // ── SOCIAL POSTS ──
  hr("PUBLISHED MARKETING POSTS");
  const { data: posts } = await supabase
    .from("published_marketing_posts")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(10);
  console.log(`Recent posts: ${(posts ?? []).length}`);
  for (const p of posts ?? []) {
    console.log(`  ${p.published_at?.slice(0, 16)} | ${p.slug}`);
  }

  // ── ETF PRICES ──
  hr("ETF PRICE DATA COVERAGE");
  const { data: tickers } = await supabase
    .from("etf_daily_prices")
    .select("ticker")
    .limit(10000);
  const tickerCounts: Record<string, number> = {};
  for (const t of tickers ?? []) {
    tickerCounts[t.ticker] = (tickerCounts[t.ticker] ?? 0) + 1;
  }
  Object.entries(tickerCounts)
    .sort(([, a], [, b]) => b - a)
    .forEach(([ticker, count]) => console.log(`  ${ticker}: ${count} days`));

  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
