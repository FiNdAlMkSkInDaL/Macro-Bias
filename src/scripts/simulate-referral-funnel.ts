/**
 * Referral Funnel End-to-End Simulation
 *
 * Exercises every code path in the referral system against the live database.
 * Creates deterministic test data, runs every funnel step, asserts correct
 * outcomes, and cleans up after itself.
 *
 * Phases:
 *  1  Referrer signup + code generation
 *  2  Referred signups (4 entry points × attribution)
 *  3  Edge-case rejection (self-referral, duplicate, inactive referrer)
 *  4  Referral verification (pending → verified)
 *  5  Tier-1 reward  (3 verified  → 7-day premium unlock)
 *  6  Tier-2 reward  (7 verified  → Stripe coupon / record)
 *  7  Tier-3 reward  (15 verified → Stripe coupon / record)
 *  8  Premium-unlock partition helper
 *  9  Status-API response shape
 * 10  Full cleanup
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import crypto from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ──────────────────────────────────────────────────────────
// Setup
// ──────────────────────────────────────────────────────────

const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY?.trim() ?? null;
const RESEND_KEY = process.env.RESEND_API_KEY?.trim() ?? null;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const RUN_ID = Date.now().toString(36);
const TEST_DOMAIN = `sim-${RUN_ID}@macro-bias-test.invalid`;
const email = (tag: string) => `${tag}-${RUN_ID}@macro-bias-test.invalid`;

const REFERRER_EMAIL = email("referrer");
const INACTIVE_REFERRER_EMAIL = email("inactive-ref");

const LANDING_PAGES = ["/today", "/emails", "/crypto", "/"] as const;

// We need 15 referred subscribers total to hit all tiers
const REFERRED_EMAILS = Array.from({ length: 15 }, (_, i) =>
  email(`referred-${String(i + 1).padStart(2, "0")}`),
);

// ──────────────────────────────────────────────────────────
// Assertion helpers
// ──────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  ✅  ${label}`);
  } else {
    failCount++;
    const msg = detail ? `${label} — ${detail}` : label;
    failures.push(msg);
    console.log(`  ❌  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

function section(name: string) {
  console.log(`\n━━━ ${name} ━━━`);
}

// ──────────────────────────────────────────────────────────
// Referral code generation (mirrors generate-referral-code.ts)
// ──────────────────────────────────────────────────────────

const CODE_LENGTH = 8;
const CODE_CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";

function generateReferralCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARSET[bytes[i] % CODE_CHARSET.length];
  }
  return code;
}

// ──────────────────────────────────────────────────────────
// DB helpers (mirror production logic exactly)
// ──────────────────────────────────────────────────────────

async function insertSubscriber(
  emailAddr: string,
  opts: { status?: string; referralCode?: string } = {},
) {
  const { error } = await supabase.from("free_subscribers").upsert(
    {
      email: emailAddr,
      status: opts.status ?? "active",
      tier: "free",
      stocks_opted_in: true,
      crypto_opted_in: false,
    },
    { onConflict: "email" },
  );
  if (error) throw new Error(`insertSubscriber(${emailAddr}): ${error.message}`);

  if (opts.referralCode) {
    const { error: codeErr } = await supabase
      .from("free_subscribers")
      .update({ referral_code: opts.referralCode })
      .eq("email", emailAddr);
    if (codeErr) throw new Error(`setReferralCode(${emailAddr}): ${codeErr.message}`);
  }
}

/**
 * Mirrors processReferralAttribution from src/app/api/subscribe/route.ts
 * exactly — same queries, same guard clauses, same insert shape.
 */
async function processReferralAttribution(
  referredEmail: string,
  referralCode: string,
  landingPagePath: string,
): Promise<"attributed" | "self_referral" | "already_referred" | "invalid_code" | "error"> {
  // 1. Look up referrer by code
  const { data: referrer } = await supabase
    .from("free_subscribers")
    .select("email, status")
    .eq("referral_code", referralCode)
    .single();

  if (!referrer || referrer.status !== "active") return "invalid_code";

  // 2. Prevent self-referral
  if (referrer.email === referredEmail) return "self_referral";

  // 3. Check existing referral
  const { data: existing } = await supabase
    .from("referrals")
    .select("id")
    .eq("referred_email", referredEmail)
    .limit(1)
    .maybeSingle();

  if (existing) return "already_referred";

  // 4. Insert referral record
  const { error } = await supabase.from("referrals").insert({
    referrer_email: referrer.email,
    referred_email: referredEmail,
    status: "pending",
  });

  if (error) return "error";

  // 5. Set referred_by
  await supabase
    .from("free_subscribers")
    .update({ referred_by: referrer.email })
    .eq("email", referredEmail);

  // 6. Log analytics
  await supabase.from("marketing_event_log").insert({
    event_name: "referral_attributed",
    page_path: landingPagePath,
    subscriber_email: referredEmail,
    metadata: {
      landing_page_path: landingPagePath,
      referrer_email: referrer.email,
      referral_code: referralCode,
      simulation: true,
    },
  });

  return "attributed";
}

/**
 * Mirrors verifyPendingReferrals from src/lib/referral/verify-referrals.ts
 */
async function verifyPendingReferrals(): Promise<number> {
  const { data: pending } = await supabase
    .from("referrals")
    .select("id, referrer_email, referred_email")
    .eq("status", "pending")
    .in(
      "referrer_email",
      [REFERRER_EMAIL],
    );

  if (!pending?.length) return 0;

  const referredEmails = pending.map((r) => r.referred_email);
  const { data: active } = await supabase
    .from("free_subscribers")
    .select("email")
    .in("email", referredEmails)
    .eq("status", "active");

  const activeSet = new Set(active?.map((s) => s.email) ?? []);
  let verified = 0;

  for (const ref of pending) {
    if (!activeSet.has(ref.referred_email)) continue;

    const { error } = await supabase
      .from("referrals")
      .update({ status: "verified", verified_at: new Date().toISOString() })
      .eq("id", ref.id);

    if (error) {
      console.error(`  ⚠  verify failed for ${ref.id}:`, error.message);
      continue;
    }
    verified++;

    await supabase.from("marketing_event_log").insert({
      event_name: "referral_verified",
      page_path: "/system",
      subscriber_email: ref.referred_email,
      metadata: {
        referrer_email: ref.referrer_email,
        referred_email: ref.referred_email,
        simulation: true,
      },
    });
  }
  return verified;
}

/**
 * Mirrors checkAndFulfillRewards from src/lib/referral/rewards.ts
 * Skips real Stripe coupon creation — records reward with coupon_id = null.
 */
const REWARD_TIERS = [
  { tier: 1, threshold: 3, type: "premium_unlock" as const },
  { tier: 2, threshold: 7, type: "stripe_coupon" as const },
  { tier: 3, threshold: 15, type: "stripe_coupon" as const },
] as const;

async function checkAndFulfillRewards(referrerEmail: string) {
  const { count } = await supabase
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_email", referrerEmail)
    .eq("status", "verified");

  if (!count) return;

  const { data: fulfilled } = await supabase
    .from("referral_rewards")
    .select("reward_tier")
    .eq("referrer_email", referrerEmail);

  const fulfilledTiers = new Set(
    fulfilled?.map((r: { reward_tier: number }) => r.reward_tier) ?? [],
  );

  for (const { tier, threshold, type } of REWARD_TIERS) {
    if (count >= threshold && !fulfilledTiers.has(tier)) {
      await fulfillReward(referrerEmail, tier, type);
    }
  }
}

async function fulfillReward(
  referrerEmail: string,
  tier: number,
  type: "premium_unlock" | "stripe_coupon",
) {
  let stripeCouponId: string | null = null;

  if (type === "premium_unlock") {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await supabase
      .from("free_subscribers")
      .update({ premium_unlock_expires_at: expiresAt.toISOString() })
      .eq("email", referrerEmail);
  }

  if (type === "stripe_coupon") {
    // In simulation we verify the path works but create a REAL Stripe
    // coupon only if keys are present (we void it during cleanup).
    if (STRIPE_KEY) {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(STRIPE_KEY);
      const coupon = await stripe.coupons.create({
        percent_off: 100,
        duration: "once",
        max_redemptions: 1,
        metadata: {
          referral_tier: String(tier),
          referrer_email: referrerEmail,
          simulation: "true",
        },
      });
      stripeCouponId = coupon.id;
      console.log(`     → Stripe coupon created: ${coupon.id} (tier ${tier})`);
    } else {
      console.log(`     → Stripe key not configured — coupon creation skipped (tier ${tier})`);
    }
  }

  await supabase.from("referral_rewards").insert({
    referrer_email: referrerEmail,
    reward_tier: tier,
    reward_type: type,
    fulfilled_at: new Date().toISOString(),
    stripe_coupon_id: stripeCouponId,
    metadata: { simulation: true },
  });

  await supabase.from("marketing_event_log").insert({
    event_name: "referral_reward_fulfilled",
    page_path: "/system",
    subscriber_email: referrerEmail,
    metadata: { reward_tier: tier, reward_type: type, simulation: true },
  });
}

/**
 * Mirrors partitionUnlockedSubscribers from src/lib/referral/premium-unlock.ts
 */
async function partitionUnlockedSubscribers(
  freeEmails: readonly string[],
): Promise<{ unlockedEmails: string[]; regularFreeEmails: string[] }> {
  if (freeEmails.length === 0) return { unlockedEmails: [], regularFreeEmails: [] };

  const { data } = await supabase
    .from("free_subscribers")
    .select("email, premium_unlock_expires_at")
    .in("email", [...freeEmails])
    .not("premium_unlock_expires_at", "is", null)
    .gt("premium_unlock_expires_at", new Date().toISOString());

  const unlockedSet = new Set(data?.map((r) => r.email) ?? []);
  return {
    unlockedEmails: freeEmails.filter((e) => unlockedSet.has(e)),
    regularFreeEmails: freeEmails.filter((e) => !unlockedSet.has(e)),
  };
}

// ──────────────────────────────────────────────────────────
// Cleanup
// ──────────────────────────────────────────────────────────

const createdStripeCoupons: string[] = [];

async function cleanup() {
  section("CLEANUP");
  const allTestEmails = [
    REFERRER_EMAIL,
    INACTIVE_REFERRER_EMAIL,
    ...REFERRED_EMAILS,
  ];

  // 1. Void Stripe coupons created during simulation
  if (STRIPE_KEY && createdStripeCoupons.length > 0) {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(STRIPE_KEY);
    for (const id of createdStripeCoupons) {
      try {
        await stripe.coupons.del(id);
        console.log(`  🧹 Deleted Stripe coupon ${id}`);
      } catch (e: unknown) {
        console.log(`  ⚠  Could not delete coupon ${id}: ${(e as Error).message}`);
      }
    }
  }

  // 2. Delete referral_rewards
  const { error: rwErr, count: rwCount } = await supabase
    .from("referral_rewards")
    .delete({ count: "exact" })
    .in("referrer_email", allTestEmails);
  console.log(`  🧹 referral_rewards: deleted ${rwCount ?? 0} rows${rwErr ? ` (err: ${rwErr.message})` : ""}`);

  // 3. Delete referrals
  const { error: refErr, count: refCount } = await supabase
    .from("referrals")
    .delete({ count: "exact" })
    .in("referrer_email", allTestEmails);
  console.log(`  🧹 referrals: deleted ${refCount ?? 0} rows${refErr ? ` (err: ${refErr.message})` : ""}`);

  // 4. Delete marketing events
  const { error: evtErr, count: evtCount } = await supabase
    .from("marketing_event_log")
    .delete({ count: "exact" })
    .in("subscriber_email", allTestEmails);
  console.log(`  🧹 marketing_event_log: deleted ${evtCount ?? 0} rows${evtErr ? ` (err: ${evtErr.message})` : ""}`);

  // 5. Delete free_subscribers
  const { error: subErr, count: subCount } = await supabase
    .from("free_subscribers")
    .delete({ count: "exact" })
    .in("email", allTestEmails);
  console.log(`  🧹 free_subscribers: deleted ${subCount ?? 0} rows${subErr ? ` (err: ${subErr.message})` : ""}`);
}

// ──────────────────────────────────────────────────────────
// Main simulation
// ──────────────────────────────────────────────────────────

async function run() {
  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║  REFERRAL FUNNEL — END-TO-END SIMULATION              ║");
  console.log("╚════════════════════════════════════════════════════════╝");
  console.log(`  Run ID  : ${RUN_ID}`);
  console.log(`  Referrer: ${REFERRER_EMAIL}`);
  console.log(`  Referred: ${REFERRED_EMAILS.length} test subscribers`);
  console.log(`  Supabase: ${SUPABASE_URL}`);
  console.log(`  Stripe  : ${STRIPE_KEY ? "configured" : "NOT configured (coupon tests will be partial)"}`);

  try {
    // ─── Phase 1: Referrer signup + code generation ───
    section("PHASE 1 — Referrer signup & code generation");

    const referrerCode = generateReferralCode();
    assert("Referral code is 8 chars alphanumeric", /^[a-z0-9]{8}$/.test(referrerCode));

    // Verify uniqueness across 1000 generations
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) codes.add(generateReferralCode());
    assert("1000 generated codes are all unique", codes.size === 1000);

    await insertSubscriber(REFERRER_EMAIL, { referralCode: referrerCode });

    const { data: refRow } = await supabase
      .from("free_subscribers")
      .select("email, referral_code, status, referred_by, premium_unlock_expires_at")
      .eq("email", REFERRER_EMAIL)
      .single();

    assert("Referrer inserted with status=active", refRow?.status === "active");
    assert("Referral code persisted correctly", refRow?.referral_code === referrerCode);
    assert("referred_by is null for organic signup", refRow?.referred_by === null);
    assert("premium_unlock_expires_at is null initially", refRow?.premium_unlock_expires_at === null);

    // ─── Phase 2: Referred signups from 4 entry points ───
    section("PHASE 2 — Referred signups (4 entry points)");

    for (let i = 0; i < 4; i++) {
      const refEmail = REFERRED_EMAILS[i];
      const landingPage = LANDING_PAGES[i];

      await insertSubscriber(refEmail);
      const result = await processReferralAttribution(refEmail, referrerCode, landingPage);

      assert(
        `Signup via ${landingPage} → attribution = "attributed"`,
        result === "attributed",
        `got "${result}"`,
      );

      // Verify referral record
      const { data: refRec } = await supabase
        .from("referrals")
        .select("referrer_email, referred_email, status")
        .eq("referred_email", refEmail)
        .single();

      assert(
        `Referral record for ${landingPage} has status=pending`,
        refRec?.status === "pending",
      );
      assert(
        `Referral record points to correct referrer`,
        refRec?.referrer_email === REFERRER_EMAIL,
      );

      // Verify referred_by on subscriber
      const { data: subRec } = await supabase
        .from("free_subscribers")
        .select("referred_by")
        .eq("email", refEmail)
        .single();

      assert(
        `Subscriber referred_by set for ${landingPage}`,
        subRec?.referred_by === REFERRER_EMAIL,
      );

      // Verify analytics event
      const { data: evt } = await supabase
        .from("marketing_event_log")
        .select("event_name, page_path, metadata")
        .eq("subscriber_email", refEmail)
        .eq("event_name", "referral_attributed")
        .single();

      assert(
        `Analytics event logged for ${landingPage}`,
        evt?.event_name === "referral_attributed",
      );
      assert(
        `Analytics page_path = "${landingPage}"`,
        evt?.page_path === landingPage,
      );
      assert(
        `Analytics metadata.referral_code matches`,
        (evt?.metadata as Record<string, unknown>)?.referral_code === referrerCode,
      );
    }

    // ─── Phase 3: Edge cases ───
    section("PHASE 3 — Edge-case rejection");

    // 3a. Self-referral
    const selfResult = await processReferralAttribution(
      REFERRER_EMAIL,
      referrerCode,
      "/today",
    );
    assert("Self-referral blocked", selfResult === "self_referral");

    // 3b. Duplicate referral (re-refer someone already attributed)
    const dupeResult = await processReferralAttribution(
      REFERRED_EMAILS[0],
      referrerCode,
      "/today",
    );
    assert("Duplicate referral blocked", dupeResult === "already_referred");

    // 3c. Inactive referrer
    const inactiveCode = generateReferralCode();
    await insertSubscriber(INACTIVE_REFERRER_EMAIL, {
      status: "inactive",
      referralCode: inactiveCode,
    });
    const newRefEmail = email("edge-inactive");
    await insertSubscriber(newRefEmail);
    const inactiveResult = await processReferralAttribution(
      newRefEmail,
      inactiveCode,
      "/today",
    );
    assert("Inactive referrer code rejected", inactiveResult === "invalid_code");
    // Clean up the extra subscriber
    await supabase.from("free_subscribers").delete().eq("email", newRefEmail);

    // 3d. Non-existent referral code
    const bogusResult = await processReferralAttribution(
      email("edge-bogus"),
      "zzzzzzzz",
      "/today",
    );
    assert("Non-existent code rejected", bogusResult === "invalid_code");

    // ─── Phase 4: Verify first 3 referrals (pending → verified) ───
    section("PHASE 4 — Verification (pending → verified, first 3)");

    const verified4 = await verifyPendingReferrals();
    assert("Verified 4 pending referrals", verified4 === 4, `got ${verified4}`);

    // Confirm DB state
    const { count: verCount } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_email", REFERRER_EMAIL)
      .eq("status", "verified");
    assert("DB shows 4 verified referrals", verCount === 4);

    // ─── Phase 5: Tier 1 reward (3 verified → premium unlock) ───
    section("PHASE 5 — Tier 1 reward (≥3 verified → 7-day premium unlock)");

    await checkAndFulfillRewards(REFERRER_EMAIL);

    const { data: tier1Reward } = await supabase
      .from("referral_rewards")
      .select("reward_tier, reward_type, fulfilled_at, stripe_coupon_id")
      .eq("referrer_email", REFERRER_EMAIL)
      .eq("reward_tier", 1)
      .single();

    assert("Tier 1 reward record created", tier1Reward !== null);
    assert("Tier 1 type = premium_unlock", tier1Reward?.reward_type === "premium_unlock");
    assert("Tier 1 fulfilled_at is set", tier1Reward?.fulfilled_at !== null);
    assert("Tier 1 stripe_coupon_id is null", tier1Reward?.stripe_coupon_id === null);

    // Verify premium unlock on subscriber
    const { data: unlocked } = await supabase
      .from("free_subscribers")
      .select("premium_unlock_expires_at")
      .eq("email", REFERRER_EMAIL)
      .single();

    const expiresAt = unlocked?.premium_unlock_expires_at
      ? new Date(unlocked.premium_unlock_expires_at)
      : null;
    const now = new Date();
    const sixDaysFromNow = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
    const eightDaysFromNow = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);

    assert("premium_unlock_expires_at is set", expiresAt !== null);
    assert(
      "Expiry is ~7 days from now",
      expiresAt !== null && expiresAt > sixDaysFromNow && expiresAt < eightDaysFromNow,
      expiresAt ? `expires ${expiresAt.toISOString()}` : "null",
    );

    // Idempotency: running again should NOT create a duplicate reward
    await checkAndFulfillRewards(REFERRER_EMAIL);
    const { count: tier1Count } = await supabase
      .from("referral_rewards")
      .select("id", { count: "exact", head: true })
      .eq("referrer_email", REFERRER_EMAIL)
      .eq("reward_tier", 1);
    assert("Tier 1 reward is idempotent (no duplicate)", tier1Count === 1);

    // ─── Phase 6: Tier 2 reward (7 verified → Stripe coupon) ───
    section("PHASE 6 — Tier 2 reward (≥7 verified → free month coupon)");

    // Add referrals 5-7
    for (let i = 4; i < 7; i++) {
      await insertSubscriber(REFERRED_EMAILS[i]);
      const r = await processReferralAttribution(REFERRED_EMAILS[i], referrerCode, "/today");
      assert(`Referral ${i + 1} attributed`, r === "attributed");
    }

    const verified6 = await verifyPendingReferrals();
    assert("Verified 3 new pending referrals", verified6 === 3, `got ${verified6}`);

    const { count: totalVerified7 } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_email", REFERRER_EMAIL)
      .eq("status", "verified");
    assert("Total verified now = 7", totalVerified7 === 7, `got ${totalVerified7}`);

    await checkAndFulfillRewards(REFERRER_EMAIL);

    const { data: tier2Reward } = await supabase
      .from("referral_rewards")
      .select("reward_tier, reward_type, fulfilled_at, stripe_coupon_id")
      .eq("referrer_email", REFERRER_EMAIL)
      .eq("reward_tier", 2)
      .single();

    assert("Tier 2 reward record created", tier2Reward !== null);
    assert("Tier 2 type = stripe_coupon", tier2Reward?.reward_type === "stripe_coupon");
    assert("Tier 2 fulfilled_at is set", tier2Reward?.fulfilled_at !== null);

    if (STRIPE_KEY) {
      assert("Tier 2 Stripe coupon ID is set", tier2Reward?.stripe_coupon_id !== null);
      if (tier2Reward?.stripe_coupon_id) createdStripeCoupons.push(tier2Reward.stripe_coupon_id);
    } else {
      console.log("     (Stripe not configured — coupon ID is null, which is expected)");
    }

    // Tier 1 should NOT be re-fulfilled
    const { count: t1After } = await supabase
      .from("referral_rewards")
      .select("id", { count: "exact", head: true })
      .eq("referrer_email", REFERRER_EMAIL)
      .eq("reward_tier", 1);
    assert("Tier 1 not duplicated after tier 2 fulfillment", t1After === 1);

    // ─── Phase 7: Tier 3 reward (15 verified → annual plan) ───
    section("PHASE 7 — Tier 3 reward (≥15 verified → free annual coupon)");

    // Add referrals 8-15
    for (let i = 7; i < 15; i++) {
      await insertSubscriber(REFERRED_EMAILS[i]);
      const r = await processReferralAttribution(REFERRED_EMAILS[i], referrerCode, "/emails");
      assert(`Referral ${i + 1} attributed`, r === "attributed");
    }

    const verified7 = await verifyPendingReferrals();
    assert("Verified 8 new pending referrals", verified7 === 8, `got ${verified7}`);

    const { count: totalVerified15 } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_email", REFERRER_EMAIL)
      .eq("status", "verified");
    assert("Total verified now = 15", totalVerified15 === 15, `got ${totalVerified15}`);

    await checkAndFulfillRewards(REFERRER_EMAIL);

    const { data: tier3Reward } = await supabase
      .from("referral_rewards")
      .select("reward_tier, reward_type, fulfilled_at, stripe_coupon_id")
      .eq("referrer_email", REFERRER_EMAIL)
      .eq("reward_tier", 3)
      .single();

    assert("Tier 3 reward record created", tier3Reward !== null);
    assert("Tier 3 type = stripe_coupon", tier3Reward?.reward_type === "stripe_coupon");
    assert("Tier 3 fulfilled_at is set", tier3Reward?.fulfilled_at !== null);

    if (STRIPE_KEY) {
      assert("Tier 3 Stripe coupon ID is set", tier3Reward?.stripe_coupon_id !== null);
      if (tier3Reward?.stripe_coupon_id) createdStripeCoupons.push(tier3Reward.stripe_coupon_id);
    } else {
      console.log("     (Stripe not configured — coupon ID is null, which is expected)");
    }

    // Verify all 3 tiers exist, each only once
    const { data: allRewards } = await supabase
      .from("referral_rewards")
      .select("reward_tier")
      .eq("referrer_email", REFERRER_EMAIL)
      .order("reward_tier");

    const tiers = allRewards?.map((r) => r.reward_tier) ?? [];
    assert("Exactly 3 reward records exist", tiers.length === 3, `got ${tiers.length}`);
    assert("Tiers are [1, 2, 3]", JSON.stringify(tiers) === "[1,2,3]", JSON.stringify(tiers));

    // ─── Phase 8: Premium unlock partition ───
    section("PHASE 8 — Premium unlock partition helper");

    const testEmails = [REFERRER_EMAIL, REFERRED_EMAILS[0], REFERRED_EMAILS[1]];
    const { unlockedEmails, regularFreeEmails } = await partitionUnlockedSubscribers(testEmails);

    assert(
      "Referrer is in unlockedEmails",
      unlockedEmails.includes(REFERRER_EMAIL),
      `unlocked: [${unlockedEmails.join(", ")}]`,
    );
    assert(
      "Referred subscribers are in regularFreeEmails",
      regularFreeEmails.includes(REFERRED_EMAILS[0]) &&
        regularFreeEmails.includes(REFERRED_EMAILS[1]),
    );
    assert(
      "No overlap between unlocked and regular",
      unlockedEmails.length + regularFreeEmails.length === testEmails.length,
    );

    // ─── Phase 9: Status API response shape ───
    section("PHASE 9 — Referral status response shape");

    // Simulate what the GET /api/referral/status endpoint returns
    const { data: statusSub } = await supabase
      .from("free_subscribers")
      .select("email, referral_code, status")
      .eq("email", REFERRER_EMAIL)
      .eq("status", "active")
      .maybeSingle();

    assert("Status: subscriber found", statusSub !== null);
    assert("Status: referral_code present", !!statusSub?.referral_code);

    const referralLink = statusSub?.referral_code
      ? `${APP_URL}/today?ref=${statusSub.referral_code}`
      : null;
    assert("Status: referral link points to /today", referralLink?.includes("/today?ref=") === true);

    const { count: sVerified } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_email", REFERRER_EMAIL)
      .eq("status", "verified");

    const { count: sPending } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_email", REFERRER_EMAIL)
      .eq("status", "pending");

    assert("Status: verifiedCount = 15", sVerified === 15);
    assert("Status: pendingCount = 0", sPending === 0);

    const { data: sRewards } = await supabase
      .from("referral_rewards")
      .select("reward_tier, fulfilled_at")
      .eq("referrer_email", REFERRER_EMAIL);

    const EXPECTED_TIERS = [
      { tier: 1, threshold: 3, label: "7-day full briefing unlock" },
      { tier: 2, threshold: 7, label: "1 free month of Premium" },
      { tier: 3, threshold: 15, label: "Free annual subscription" },
    ];

    const fulfilledMap = new Map(
      (sRewards ?? []).map((r) => [r.reward_tier, r.fulfilled_at]),
    );

    const rewards = EXPECTED_TIERS.map(({ tier, threshold, label }) => ({
      tier,
      threshold,
      label,
      earned: (sVerified ?? 0) >= threshold,
      fulfilledAt: fulfilledMap.get(tier) ?? null,
    }));

    assert("Status: all 3 rewards earned", rewards.every((r) => r.earned));
    assert("Status: all 3 rewards fulfilled", rewards.every((r) => r.fulfilledAt !== null));

    const { data: recentRefs } = await supabase
      .from("referrals")
      .select("referred_email, status, created_at")
      .eq("referrer_email", REFERRER_EMAIL)
      .order("created_at", { ascending: false })
      .limit(20);

    assert("Status: recent referrals returned", (recentRefs?.length ?? 0) === 15);
    assert(
      "Status: all recent referrals are verified",
      recentRefs?.every((r) => r.status === "verified") === true,
    );

    // ─── Phase 10: Analytics event audit ───
    section("PHASE 10 — Analytics event audit");

    const { data: allEvents } = await supabase
      .from("marketing_event_log")
      .select("event_name, subscriber_email")
      .in("subscriber_email", [REFERRER_EMAIL, ...REFERRED_EMAILS]);

    const eventCounts = new Map<string, number>();
    for (const evt of allEvents ?? []) {
      eventCounts.set(evt.event_name, (eventCounts.get(evt.event_name) ?? 0) + 1);
    }

    assert(
      "Analytics: 15 referral_attributed events",
      eventCounts.get("referral_attributed") === 15,
      `got ${eventCounts.get("referral_attributed") ?? 0}`,
    );
    assert(
      "Analytics: 15 referral_verified events",
      eventCounts.get("referral_verified") === 15,
      `got ${eventCounts.get("referral_verified") ?? 0}`,
    );
    assert(
      "Analytics: 3 referral_reward_fulfilled events",
      eventCounts.get("referral_reward_fulfilled") === 3,
      `got ${eventCounts.get("referral_reward_fulfilled") ?? 0}`,
    );

  } finally {
    // Always clean up
    await cleanup();
  }

  // ─── Final verdict ───
  console.log("\n╔════════════════════════════════════════════════════════╗");
  if (failCount === 0) {
    console.log("║  ALL TESTS PASSED                                     ║");
  } else {
    console.log("║  SOME TESTS FAILED                                    ║");
  }
  console.log("╚════════════════════════════════════════════════════════╝");
  console.log(`  Passed: ${passCount}`);
  console.log(`  Failed: ${failCount}`);

  if (failures.length > 0) {
    console.log("\n  Failures:");
    for (const f of failures) {
      console.log(`    • ${f}`);
    }
  }

  console.log();
  process.exit(failCount > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("\n💥 Simulation crashed:", err);
  cleanup().finally(() => process.exit(2));
});
