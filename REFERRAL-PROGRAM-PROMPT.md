# Referral Program: Full Implementation Brief

You are building a **subscriber referral program** for an existing production product called Macro Bias (macro-bias.com). The product sends two daily email briefings (stocks and crypto) and has an existing free → premium conversion funnel. Your job is to add a referral system that rewards existing subscribers for bringing in new ones, with milestone-based reward tiers, a dedicated `/refer` page, in-email referral widgets, welcome drip integration, and full analytics tracking.

Read this entire document before writing any code. Then create a detailed plan. Then execute.

---

## 1. THE EXISTING SYSTEM

### Architecture
- **Framework**: Next.js 15 (App Router), deployed on Vercel Hobby plan
- **Database**: Supabase (Postgres)
- **Email**: Resend API, from `Macro Bias <briefing@macro-bias.com>`
- **Billing**: Stripe ($25/mo or $190/yr), 7-day free trial
- **Analytics**: First-party event tracking via `marketing_event_log` table
- **Crons** (vercel.json):
  - `/api/cron/publish` at 12:45 UTC — stocks briefing
  - `/api/cron/crypto-publish` at 13:00 UTC — crypto briefing
  - `/api/cron/welcome-drip` at 10:00 UTC — welcome drip emails
  - `/api/cron/social-dispatch` at 17:00 UTC — social post dispatch

### Current Database Schema

**`free_subscribers` table**:
```sql
email           text PRIMARY KEY
status          text NOT NULL DEFAULT 'active'   CHECK (status IN ('active', 'inactive'))
tier            text NOT NULL DEFAULT 'free'     CHECK (tier IN ('free'))
stocks_opted_in boolean NOT NULL DEFAULT true
crypto_opted_in boolean NOT NULL DEFAULT false
created_at      timestamptz
updated_at      timestamptz
```

**`marketing_event_log` table**:
```sql
id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
event_name        text NOT NULL
page_path         text NOT NULL
session_id        text
anonymous_id      text
subscriber_email  text
referrer          text
utm_source        text
utm_medium        text
utm_campaign      text
metadata          jsonb NOT NULL DEFAULT '{}'
created_at        timestamptz
```

**`welcome_email_drip_enrollments` table**:
```sql
email         text PRIMARY KEY
status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'unsubscribed'))
enrolled_at   timestamptz
completed_at  timestamptz
updated_at    timestamptz
```

**`welcome_email_drip_deliveries` table**:
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
email           text NOT NULL REFERENCES welcome_email_drip_enrollments(email) ON DELETE CASCADE
sequence_day    integer NOT NULL CHECK (sequence_day IN (0, 1, 3, 7))
sequence_order  integer NOT NULL CHECK (sequence_order BETWEEN 1 AND 4)
scheduled_for   timestamptz
delivered_at    timestamptz
resend_email_id text
status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'failed', 'cancelled'))
error_message   text
created_at      timestamptz
updated_at      timestamptz
UNIQUE (email, sequence_order)
```

### Current Signup Flow

1. User visits `/emails`, `/crypto`, or homepage (`/`)
2. Enters email + selects Stocks/Crypto checkboxes
3. Frontend POSTs to `/api/subscribe` with `{ email, pagePath, stocksOptedIn, cryptoOptedIn }`
4. API upserts into `free_subscribers`, enrolls in welcome drip, logs `email_subscribed` event
5. Immediate dispatch of welcome email step 1 (day 0)
6. Welcome drip continues: day 1, day 3, day 7

### Current Subscribe Endpoint (`src/app/api/subscribe/route.ts`)

```typescript
export async function POST(request: Request) {
  // ... parse { email, pagePath, stocksOptedIn, cryptoOptedIn }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from('free_subscribers').upsert(
    {
      email,
      status: 'active',
      tier: 'free',
      stocks_opted_in: stocksOptedIn,
      crypto_opted_in: cryptoOptedIn,
    },
    { onConflict: 'email' },
  );

  // ... enrollSubscriberInWelcomeDrip(email)
  // ... logMarketingEvent({ eventName: 'email_subscribed', ... })
  // ... dispatchPendingWelcomeDripEmails({ email, limit: 1 })

  return NextResponse.json({ message: SUBSCRIBE_SUCCESS_MESSAGE, ok: true });
}
```

### Current Email Footer (in `src/lib/marketing/email-dispatch.ts`)

The stocks email footer currently contains:
1. A crypto cross-sell banner (`"Now Available: Daily Crypto Regime Briefing"`)
2. An unsubscribe link

The footer HTML lives at the bottom of `buildEmailHtml()` inside `email-dispatch.ts`, approximately lines 1045-1060.

### Current Welcome Drip (`src/lib/marketing/welcome-drip.ts`)

4 steps: `WELCOME_DRIP_STEPS` array, each with `dayOffset`, `subject`, `hook`, `bullets`, `ctaHref`, `ctaLabel`, `secondaryHref`, `secondaryLabel`, `microChallenge`.

Step 1 (day 0): "Your daily market read starts tomorrow" — welcomes, shows stats, links to track record
Step 2 (day 1): "The 90-second morning routine" — teaches the workflow
Step 3 (day 3): "The mistake that costs most traders the most money" — regime awareness pitch
Step 4 (day 7): "See what is behind the daily score" — premium upsell with 7-day trial CTA

The email HTML builder is `createWelcomeDripEmailContent(step, recipientEmail)` which returns `{ html, subject, text, unsubscribeUrl }`.

### Current Analytics

**Server-side** (`src/lib/analytics/server.ts`):
```typescript
export async function logMarketingEvent(input: {
  anonymousId?: string | null;
  eventName: string;
  metadata?: Record<string, unknown>;
  pagePath: string;
  referrer?: string | null;
  sessionId?: string | null;
  subscriberEmail?: string | null;
  utmCampaign?: string | null;
  utmMedium?: string | null;
  utmSource?: string | null;
})
```

**Client-side** (`src/lib/analytics/client.ts`):
```typescript
export function trackClientEvent(event: {
  eventName: string;
  metadata?: Record<string, unknown>;
  pagePath?: string;
  referrer?: string | null;
  subscriberEmail?: string | null;
})
```

### File Structure You Need to Know

```
src/
  app/
    api/
      subscribe/
        route.ts                    <-- signup endpoint (MODIFY)
        unsubscribe/route.ts        <-- unsubscribe endpoint (NO CHANGE)
      checkout/route.ts             <-- Stripe checkout (NO CHANGE)
    emails/page.tsx                 <-- primary signup page (MODIFY)
    crypto/page.tsx                 <-- crypto signup page (MODIFY)
    page.tsx                        <-- homepage with signup form (MODIFY)
  lib/
    marketing/
      email-dispatch.ts             <-- stocks email builder + dispatch (MODIFY footer)
      welcome-drip.ts               <-- welcome drip system (MODIFY step 2)
    analytics/
      client.ts                     <-- client event tracking (REUSE)
      server.ts                     <-- server event tracking (REUSE)
    billing/
      subscription.ts               <-- Stripe management (FOR REWARD FULFILLMENT)
    supabase/
      admin.ts                      <-- admin Supabase client factory (REUSE)
    server-env.ts                   <-- env var helpers (REUSE)
  types/
    index.ts                        <-- shared types (MODIFY)
```

---

## 2. WHAT YOU ARE BUILDING

### Design Decisions (already made, do not change)

1. **Referral link, not referral code** — each subscriber gets a unique URL like `macro-bias.com/emails?ref=abc123`
2. **Milestone-based rewards, not per-referral payouts** — we are not paying cash per referral
3. **Referral tracking happens at subscribe time** — the `ref` param is captured when the new subscriber signs up
4. **Only active, confirmed subscribers count** — a referral is only credited when the referred email actually receives their first daily email (prevents self-referrals and disposable emails)
5. **Rewards are progressive (keep all lower rewards)** — hitting 7 referrals means you already got the 3-referral reward
6. **One referral code per subscriber** — generated at subscribe time, permanent, never changes
7. **No expiration on referral codes** — they work forever
8. **No double-dipping** — a referred subscriber can only be attributed to one referrer

### Reward Tiers

| Milestone | Referrals | Reward |
|-----------|-----------|--------|
| Tier 1 | 3 verified | 7-day full briefing unlock (free subscriber sees premium content for 7 days) |
| Tier 2 | 7 verified | 1 free month of Premium ($25 value, via Stripe coupon or manual credit) |
| Tier 3 | 15 verified | Free annual subscription ($190 value, via Stripe coupon) |

**Reward fulfillment mechanics:**

- **Tier 1 (7-day unlock)**: Set a `premium_unlock_expires_at` timestamp on `free_subscribers`. Both email crons check this: if current time < expiry, send full briefing instead of preview. No Stripe involvement.
- **Tier 2 (1 free month)**: Generate a one-time Stripe coupon for 100% off 1 month. Email the referrer a unique checkout link with the coupon pre-applied. The referrer must create a Stripe subscription (which starts free for 1 month, then $25/mo).
- **Tier 3 (free annual)**: Generate a one-time Stripe coupon for 100% off 1 year on the annual plan. Same delivery mechanism as Tier 2.

### What Needs to Change

| # | Area | Change |
|---|------|--------|
| 1 | Database | New `referral_codes` table |
| 2 | Database | New `referrals` table |
| 3 | Database | Add `referral_code`, `referred_by`, `premium_unlock_expires_at` columns to `free_subscribers` |
| 4 | Subscribe API | Accept `ref` param, attribute referral, generate referral code for new subscriber |
| 5 | New API route | `/api/referral/status` — returns referral count + rewards for a given email |
| 6 | New page | `/refer` — dedicated referral hub page |
| 7 | Email footer | Add referral widget to daily stocks email + daily crypto email |
| 8 | Welcome drip | Add referral mention to step 2 (day 1) |
| 9 | Email crons | Check `premium_unlock_expires_at` for Tier 1 reward |
| 10 | Signup pages | Pass `ref` query param through to subscribe API |
| 11 | Analytics | Track referral events |

---

## 3. DATABASE MIGRATION

Create file: `supabase/migrations/202604170001_create_referral_program.sql`

```sql
-- ============================================================
-- REFERRAL PROGRAM SCHEMA
-- ============================================================

-- 1. Add referral columns to free_subscribers
ALTER TABLE public.free_subscribers
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by text,
  ADD COLUMN IF NOT EXISTS premium_unlock_expires_at timestamptz;

-- 2. Create referrals tracking table
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_email text NOT NULL,
  referred_email text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_email ON public.referrals (referrer_email);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON public.referrals (status);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- 3. Create reward fulfillment log
CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_email text NOT NULL,
  reward_tier integer NOT NULL CHECK (reward_tier IN (1, 2, 3)),
  reward_type text NOT NULL CHECK (reward_type IN ('premium_unlock', 'stripe_coupon')),
  fulfilled_at timestamptz,
  stripe_coupon_id text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON public.referral_rewards (referrer_email);
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

-- 4. Add updated_at trigger to referrals table
CREATE TRIGGER set_referrals_updated_at
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
```

After creating the migration file, run the SQL directly in the Supabase SQL Editor (Vercel Hobby plan does not have Supabase CLI linked).

---

## 4. REFERRAL CODE GENERATION

Create file: `src/lib/referral/generate-referral-code.ts`

**Requirements:**
- Codes must be URL-safe: lowercase alphanumeric only
- 8 characters long (62^8 = 218 trillion combinations — no collision risk at our scale)
- Generated from `crypto.randomBytes` (server-side) for cryptographic randomness
- NOT derived from email (no hashing the email — that would be reversible and a privacy leak)

```typescript
import crypto from 'crypto';

const CODE_LENGTH = 8;
const CODE_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function generateReferralCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARSET[bytes[i] % CODE_CHARSET.length];
  }
  return code;
}
```

**Collision handling:** The `referral_code` column has a UNIQUE constraint. If `generateReferralCode()` produces a duplicate (astronomically unlikely), the upsert will fail. Catch the error and retry once with a new code. Do NOT loop.

---

## 5. REFERRAL ATTRIBUTION FLOW

### How a referral gets tracked (end-to-end)

```
1. Existing subscriber shares: macro-bias.com/emails?ref=abc123
2. New visitor lands on /emails, /crypto, or / with ?ref=abc123
3. Frontend reads `ref` from URL search params
4. Frontend stores `ref` in sessionStorage (persists across page navigations within session)
5. On form submit, frontend includes `ref` in POST to /api/subscribe
6. Subscribe API:
   a. Looks up referral_code -> referrer_email in free_subscribers
   b. Validates: referrer exists, is active, referrer != new subscriber
   c. Upserts new subscriber with referred_by = referrer_email
   d. Inserts row into referrals table with status = 'pending'
   e. Generates a new referral_code for the new subscriber
7. Referral stays 'pending' until verification (see section 6)
```

### Subscribe API Changes (`src/app/api/subscribe/route.ts`)

**Request body changes:**
```typescript
type SubscribeRequestBody = {
  email?: unknown;
  pagePath?: unknown;
  stocksOptedIn?: unknown;
  cryptoOptedIn?: unknown;
  ref?: unknown;  // NEW: referral code from URL
};
```

**New logic after successful upsert:**

```typescript
// After the existing upsert succeeds...

// 1. Generate referral code for new subscriber (if they don't already have one)
const newReferralCode = generateReferralCode();
const { error: codeError } = await supabase
  .from('free_subscribers')
  .update({ referral_code: newReferralCode })
  .eq('email', email)
  .is('referral_code', null);  // only set if not already set

if (codeError) {
  console.error('[subscribe] referral code generation failed', codeError);
  // Non-fatal — subscriber is still created, just no referral code yet
}

// 2. Process referral attribution (if ref param provided)
const refCode = typeof payload.ref === 'string' ? payload.ref.trim().toLowerCase().slice(0, 16) : null;

if (refCode) {
  await processReferralAttribution(supabase, email, refCode);
}
```

**The `processReferralAttribution` function:**

```typescript
async function processReferralAttribution(
  supabase: SupabaseClient,
  referredEmail: string,
  referralCode: string,
) {
  // 1. Look up referrer by code
  const { data: referrer } = await supabase
    .from('free_subscribers')
    .select('email, status')
    .eq('referral_code', referralCode)
    .single();

  if (!referrer || referrer.status !== 'active') {
    console.log('[subscribe] invalid or inactive referral code:', referralCode);
    return;
  }

  // 2. Prevent self-referral
  if (referrer.email === referredEmail) {
    console.log('[subscribe] self-referral blocked:', referredEmail);
    return;
  }

  // 3. Check if this email was already referred by someone
  const { data: existingReferral } = await supabase
    .from('referrals')
    .select('id')
    .eq('referred_email', referredEmail)
    .limit(1)
    .maybeSingle();

  if (existingReferral) {
    console.log('[subscribe] email already referred, skipping:', referredEmail);
    return;
  }

  // 4. Create the referral record
  const { error } = await supabase.from('referrals').insert({
    referrer_email: referrer.email,
    referred_email: referredEmail,
    status: 'pending',
  });

  if (error) {
    console.error('[subscribe] referral insert failed', error);
    return;
  }

  // 5. Set referred_by on the subscriber
  await supabase
    .from('free_subscribers')
    .update({ referred_by: referrer.email })
    .eq('email', referredEmail);

  // 6. Log analytics event
  await logMarketingEvent({
    eventName: 'referral_attributed',
    pagePath: '/api/subscribe',
    subscriberEmail: referredEmail,
    metadata: {
      referrer_email: referrer.email,
      referral_code: referralCode,
    },
  });
}
```

**Important:** The referral attribution is a side effect. If it fails, the subscription still succeeds. Wrap the entire referral processing in a try/catch and log errors. Do NOT let referral failures prevent a subscriber from being created.

---

## 6. REFERRAL VERIFICATION

A referral moves from `pending` to `verified` when the referred subscriber receives their first daily email. This proves:
- The email is real (not a throwaway)
- The subscriber actually opened/engaged (they're on the active list when the cron runs)

### Verification trigger

Add to **both** the stocks publish cron (`src/app/api/cron/publish/route.ts`) and the crypto publish cron (`src/app/api/cron/crypto-publish/route.ts`):

After successfully dispatching emails, call a shared function:

```typescript
import { verifyPendingReferrals } from '@/lib/referral/verify-referrals';

// At the end of the cron, after dispatch succeeds:
await verifyPendingReferrals(supabase);
```

### The verification function

Create file: `src/lib/referral/verify-referrals.ts`

```typescript
export async function verifyPendingReferrals(supabase: SupabaseClient) {
  // 1. Get all pending referrals where the referred_email is an active subscriber
  const { data: pendingReferrals, error } = await supabase
    .from('referrals')
    .select('id, referrer_email, referred_email')
    .eq('status', 'pending');

  if (error || !pendingReferrals?.length) return;

  // 2. Check which referred emails are active subscribers
  const referredEmails = pendingReferrals.map(r => r.referred_email);
  const { data: activeSubscribers } = await supabase
    .from('free_subscribers')
    .select('email')
    .in('email', referredEmails)
    .eq('status', 'active');

  const activeSet = new Set(activeSubscribers?.map(s => s.email) ?? []);

  // 3. Verify referrals for active subscribers
  const toVerify = pendingReferrals.filter(r => activeSet.has(r.referred_email));

  for (const referral of toVerify) {
    await supabase
      .from('referrals')
      .update({ status: 'verified', verified_at: new Date().toISOString() })
      .eq('id', referral.id);

    // 4. Check if referrer hit a new milestone
    await checkAndFulfillRewards(supabase, referral.referrer_email);
  }
}
```

### The reward check function

Create file: `src/lib/referral/rewards.ts`

```typescript
const REWARD_TIERS = [
  { tier: 1, threshold: 3, type: 'premium_unlock' as const },
  { tier: 2, threshold: 7, type: 'stripe_coupon' as const },
  { tier: 3, threshold: 15, type: 'stripe_coupon' as const },
] as const;

export async function checkAndFulfillRewards(
  supabase: SupabaseClient,
  referrerEmail: string,
) {
  // 1. Count verified referrals
  const { count } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_email', referrerEmail)
    .eq('status', 'verified');

  if (!count) return;

  // 2. Get already-fulfilled rewards
  const { data: fulfilled } = await supabase
    .from('referral_rewards')
    .select('reward_tier')
    .eq('referrer_email', referrerEmail);

  const fulfilledTiers = new Set(fulfilled?.map(r => r.reward_tier) ?? []);

  // 3. Check each tier
  for (const { tier, threshold, type } of REWARD_TIERS) {
    if (count >= threshold && !fulfilledTiers.has(tier)) {
      await fulfillReward(supabase, referrerEmail, tier, type);
    }
  }
}
```

### Reward fulfillment

```typescript
async function fulfillReward(
  supabase: SupabaseClient,
  referrerEmail: string,
  tier: number,
  type: 'premium_unlock' | 'stripe_coupon',
) {
  if (type === 'premium_unlock') {
    // Tier 1: Set premium_unlock_expires_at to 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await supabase
      .from('free_subscribers')
      .update({ premium_unlock_expires_at: expiresAt.toISOString() })
      .eq('email', referrerEmail);
  }

  if (type === 'stripe_coupon') {
    // Tier 2 or 3: Generate Stripe coupon + email the referrer
    // See section 6a below
    await createAndEmailStripeCoupon(referrerEmail, tier);
  }

  // Log the reward
  await supabase.from('referral_rewards').insert({
    referrer_email: referrerEmail,
    reward_tier: tier,
    reward_type: type,
    fulfilled_at: new Date().toISOString(),
  });

  // Log analytics
  await logMarketingEvent({
    eventName: 'referral_reward_fulfilled',
    pagePath: '/system',
    subscriberEmail: referrerEmail,
    metadata: { reward_tier: tier, reward_type: type },
  });
}
```

### 6a. Stripe Coupon Creation

```typescript
import Stripe from 'stripe';

async function createAndEmailStripeCoupon(referrerEmail: string, tier: number) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const resend = new Resend(process.env.RESEND_API_KEY!);

  const isAnnual = tier === 3;
  const couponParams: Stripe.CouponCreateParams = {
    percent_off: 100,
    duration: 'once',
    max_redemptions: 1,
    metadata: {
      referral_tier: String(tier),
      referrer_email: referrerEmail,
    },
  };

  const coupon = await stripe.coupons.create(couponParams);

  // Build checkout URL with coupon
  const priceId = isAnnual
    ? process.env.STRIPE_ANNUAL_PRICE_ID!
    : process.env.STRIPE_MONTHLY_PRICE_ID!;

  const appUrl = getAppUrl();
  const checkoutUrl = `${appUrl}/api/checkout?plan=${isAnnual ? 'annual' : 'monthly'}&coupon=${coupon.id}`;

  // Email the referrer
  const rewardLabel = isAnnual ? 'Free Annual Subscription' : '1 Free Month of Premium';
  const rewardValue = isAnnual ? '$190' : '$25';

  await resend.emails.send({
    from: getConfiguredFromAddress(),
    to: referrerEmail,
    subject: `You earned a reward: ${rewardLabel}`,
    html: buildRewardNotificationEmailHtml(referrerEmail, rewardLabel, rewardValue, checkoutUrl, tier),
  });
}
```

**Checkout endpoint change** (`src/app/api/checkout/route.ts`): The checkout route needs to accept an optional `coupon` query param and pass it to Stripe's `checkout.sessions.create()` as `discounts: [{ coupon }]`. Read the current checkout route and add a single conditional:

```typescript
const coupon = searchParams.get('coupon');

const sessionParams: Stripe.Checkout.SessionCreateParams = {
  // ... existing params
  ...(coupon && { discounts: [{ coupon }] }),
};
```

If the `coupon` param is present, add it to discounts. If not, behavior is unchanged. The Stripe API validates the coupon — if it's invalid or already redeemed, checkout fails gracefully.

---

## 7. PREMIUM UNLOCK CHECK (Tier 1 Reward)

Both email dispatch paths need to check whether a free subscriber has an active premium unlock.

### Stocks email (`src/lib/marketing/email-dispatch.ts`)

Currently the stocks cron calls `dispatchQuantBriefing()` twice: once for premium recipients, once for free recipients. The free recipients get the paywalled preview.

**Change**: Before dispatching to free recipients, partition them:

```typescript
// In the stocks publish cron, after getting freeRecipients:
const { unlockedEmails, regularFreeEmails } = await partitionUnlockedSubscribers(
  supabase,
  freeRecipients,
);

// Dispatch premium content to unlocked subscribers
if (unlockedEmails.length > 0) {
  await dispatchQuantBriefing(copy, score, label, override, {
    recipients: unlockedEmails,
    tier: 'premium',
    weeklyDigest,
  });
}

// Dispatch paywalled content to regular free subscribers
if (regularFreeEmails.length > 0) {
  await dispatchQuantBriefing(copy, score, label, override, {
    recipients: regularFreeEmails,
    tier: 'free',
    weeklyDigest,
  });
}
```

### The partition helper

Create in `src/lib/referral/premium-unlock.ts`:

```typescript
export async function partitionUnlockedSubscribers(
  supabase: SupabaseClient,
  freeEmails: readonly string[],
): Promise<{ unlockedEmails: string[]; regularFreeEmails: string[] }> {
  if (freeEmails.length === 0) {
    return { unlockedEmails: [], regularFreeEmails: [] };
  }

  const { data } = await supabase
    .from('free_subscribers')
    .select('email, premium_unlock_expires_at')
    .in('email', [...freeEmails])
    .not('premium_unlock_expires_at', 'is', null)
    .gt('premium_unlock_expires_at', new Date().toISOString());

  const unlockedSet = new Set(data?.map(r => r.email) ?? []);

  return {
    unlockedEmails: freeEmails.filter(e => unlockedSet.has(e)),
    regularFreeEmails: freeEmails.filter(e => !unlockedSet.has(e)),
  };
}
```

### Crypto email

Apply the same partition logic in the crypto publish cron (`src/app/api/cron/crypto-publish/route.ts`). The crypto cron already has a tiered dispatch (free preview + premium full). Add the same `partitionUnlockedSubscribers` call before dispatching.

---

## 8. NEW API ROUTE: `/api/referral/status`

Create file: `src/app/api/referral/status/route.ts`

This endpoint powers the `/refer` page. It returns a subscriber's referral stats.

**Request**: `GET /api/referral/status?email=user@example.com`

**Response**:
```json
{
  "referralCode": "abc12345",
  "referralLink": "https://www.macro-bias.com/emails?ref=abc12345",
  "verifiedCount": 5,
  "pendingCount": 2,
  "totalCount": 7,
  "rewards": [
    { "tier": 1, "threshold": 3, "earned": true, "fulfilledAt": "2026-04-15T..." },
    { "tier": 2, "threshold": 7, "earned": true, "fulfilledAt": null },
    { "tier": 3, "threshold": 15, "earned": false, "fulfilledAt": null }
  ],
  "recentReferrals": [
    { "referredEmail": "j***@gmail.com", "status": "verified", "createdAt": "2026-04-14T..." },
    { "referredEmail": "s***@yahoo.com", "status": "pending", "createdAt": "2026-04-15T..." }
  ]
}
```

**Security**: This endpoint returns sensitive data. The email param should be validated:
- Require the email to match a valid `free_subscribers` row
- Mask referred emails in the response (show only first letter + domain)
- Do NOT return referrer emails or any PII beyond what the requester owns
- Rate limit: 10 requests per minute per IP (use a simple in-memory counter since Vercel is serverless — this is soft protection, not bulletproof)

**Masking function:**
```typescript
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}***@${domain}`;
}
```

---

## 9. NEW PAGE: `/refer`

Create file: `src/app/refer/page.tsx`

This is a client component page where subscribers check their referral stats and copy their link.

### Page Layout

```
┌─────────────────────────────────────────────────────┐
│  [ Referral Program ]                               │
│                                                     │
│  Share Macro Bias. Earn rewards.                    │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  Your email: [___________________] [Load]   │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  (After loading)                                    │
│                                                     │
│  Your referral link:                                │
│  ┌─────────────────────────────────────────────┐    │
│  │  https://macro-bias.com/emails?ref=abc123   │    │
│  │                              [Copy Link]    │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  Verified referrals: 5 of 7 needed for next reward  │
│  ████████████░░░░░░░░ 71%                          │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │  Tier 1  │  │  Tier 2  │  │  Tier 3  │         │
│  │  3 refs  │  │  7 refs  │  │  15 refs │         │
│  │  7-day   │  │  1 free  │  │  Free    │         │
│  │  unlock  │  │  month   │  │  annual  │         │
│  │  ✓ EARNED│  │  ○ 5/7   │  │  ○ 5/15  │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│                                                     │
│  Recent referrals:                                  │
│  j***@gmail.com — verified — Apr 14                 │
│  s***@yahoo.com — pending — Apr 15                  │
│                                                     │
│  How it works:                                      │
│  1. Share your unique link                          │
│  2. Friends subscribe to the free daily briefing    │
│  3. Once they receive their first email, it counts  │
│  4. Hit milestones, earn rewards automatically      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Design Spec

- **"use client"** component (needs clipboard API, fetch, state)
- Dark theme matching site: `bg-zinc-950`, `text-white`, `border-zinc-800`
- Progress bar: `bg-sky-500` fill on `bg-zinc-800` track
- Reward cards: `border-zinc-800`, earned cards get `border-sky-500` accent
- Copy button: uses `navigator.clipboard.writeText()`, shows "Copied!" for 2 seconds
- Email input for lookup: subscriber enters their email, hits Load, fetches `/api/referral/status`
- Analytics: fire `referral_page_viewed` on mount, `referral_link_copied` on copy click

### Copy-to-clipboard with share fallback

```typescript
async function handleCopy() {
  const link = `${window.location.origin}/emails?ref=${referralCode}`;
  try {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    trackClientEvent({ eventName: 'referral_link_copied' });
  } catch {
    // Fallback for mobile or permission-denied
    prompt('Copy your referral link:', link);
  }
}
```

---

## 10. SIGNUP PAGE CHANGES

### `/emails` page (`src/app/emails/page.tsx`)

Changes:
1. Read `ref` from URL search params on mount
2. Store in component state (and sessionStorage for persistence)
3. Include `ref` in the POST body to `/api/subscribe`

```typescript
// At the top of the component:
const searchParams = useSearchParams();
const [refCode, setRefCode] = useState<string | null>(null);

useEffect(() => {
  const ref = searchParams.get('ref');
  if (ref) {
    setRefCode(ref);
    sessionStorage.setItem('macro_bias_ref', ref);
  } else {
    const stored = sessionStorage.getItem('macro_bias_ref');
    if (stored) setRefCode(stored);
  }
}, [searchParams]);

// In the form submit handler:
body: JSON.stringify({
  email,
  pagePath: window.location.pathname,
  stocksOptedIn,
  cryptoOptedIn,
  ref: refCode,
}),
```

4. After successful signup, show the subscriber's own referral link:

```typescript
// After success state is set:
{status === 'success' && (
  <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center">
    <p className="text-sm text-zinc-400">Know someone who'd find this useful?</p>
    <p className="mt-1 text-xs text-zinc-500">
      Share your link and earn rewards →{' '}
      <a href="/refer" className="text-sky-400 underline">See referral program</a>
    </p>
  </div>
)}
```

### `/crypto` page (`src/app/crypto/page.tsx`)

Same changes as `/emails`:
1. Read `ref` from search params, store in sessionStorage
2. Include `ref` in POST body
3. Show referral program link after success

### Homepage (`src/app/page.tsx`)

Same pattern:
1. Read `ref` from search params, store in sessionStorage
2. Include `ref` in newsletter subscribe POST body
3. Small referral mention after success

---

## 11. EMAIL FOOTER REFERRAL WIDGET

### Stocks daily email (`src/lib/marketing/email-dispatch.ts`)

Replace the existing crypto cross-sell banner (lines ~1045-1051) with a referral widget + smaller crypto mention:

```html
<!-- Referral widget -->
<div style="margin-top: 32px; padding: 16px 20px; border: 1px solid rgba(56,189,248,0.2); border-radius: 8px; background: rgba(56,189,248,0.04); text-align: center;">
  <p style="margin: 0; color: #7dd3fc; font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;">Refer &amp; Earn</p>
  <p style="margin: 6px 0 0; color: #e2e8f0; font-size: 14px;">Share Macro Bias with 3 friends → unlock 7 days of the full briefing, free.</p>
  <a href="{{REFERRAL_PAGE_URL}}" style="display: inline-block; margin-top: 10px; color: #38bdf8; font-size: 12px; font-weight: 600; text-decoration: underline;">Get your referral link &rarr;</a>
</div>

<!-- Crypto cross-sell (kept, but smaller) -->
<div style="margin-top: 12px; text-align: center;">
  <a href="{{EMAILS_URL}}" style="color: #475569; font-size: 11px; text-decoration: underline;">Also available: Daily Crypto Regime Briefing</a>
</div>
```

The `{{REFERRAL_PAGE_URL}}` placeholder should resolve to `https://www.macro-bias.com/refer`. This is NOT a per-recipient value — everyone gets the same URL because the `/refer` page requires email lookup. This keeps the email builder simple and avoids needing to query referral codes during dispatch.

### Crypto daily email

Add the same referral widget to the crypto email HTML builder in the crypto publish cron route. Place it between the briefing body and the unsubscribe link.

### Welcome drip emails

**Modify step 2 only** (day 1, "The 90-second morning routine that changes how you trade").

Add one paragraph to the existing `paragraphs` array:

```typescript
"One more thing: every subscriber gets a unique referral link. Share it with 3 friends who trade and you will unlock the full premium briefing free for 7 days. Check your referral status at macro-bias.com/refer."
```

Do NOT modify steps 1, 3, or 4. Step 1 is the welcome (too early to mention referrals). Step 3 is the behavioral pitch. Step 4 is the premium upsell. Step 2 is the workflow email — the ideal moment to introduce "here's another way to get more value."

---

## 12. ANALYTICS EVENTS

Track these events throughout the referral funnel:

| Event | Where | Metadata |
|-------|-------|----------|
| `referral_page_viewed` | `/refer` page mount | — |
| `referral_link_copied` | `/refer` page copy button | — |
| `referral_status_loaded` | `/refer` page after fetch | `{ verified_count, pending_count }` |
| `referral_attributed` | Subscribe API | `{ referrer_email, referral_code }` |
| `referral_verified` | Verify function in cron | `{ referrer_email, referred_email }` |
| `referral_reward_fulfilled` | Reward fulfillment | `{ reward_tier, reward_type }` |
| `referral_link_clicked` | Signup page with `?ref=` | `{ referral_code }` (client-side on page load) |

All events use the existing `logMarketingEvent` (server) or `trackClientEvent` (client) functions. No new analytics infrastructure needed.

---

## 13. FILE-BY-FILE SUMMARY

| # | File | Action | What Changes |
|---|------|--------|-------------|
| 1 | `supabase/migrations/202604170001_create_referral_program.sql` | CREATE | Full migration (3 new columns, 2 new tables) |
| 2 | `src/lib/referral/generate-referral-code.ts` | CREATE | 8-char random code generator |
| 3 | `src/lib/referral/verify-referrals.ts` | CREATE | Pending → verified promotion, reward check trigger |
| 4 | `src/lib/referral/rewards.ts` | CREATE | Reward tier definitions, fulfillment logic, Stripe coupon creation |
| 5 | `src/lib/referral/premium-unlock.ts` | CREATE | Partition free subs by premium unlock status |
| 6 | `src/app/api/referral/status/route.ts` | CREATE | GET endpoint for referral stats |
| 7 | `src/app/refer/page.tsx` | CREATE | Referral hub page |
| 8 | `src/app/api/subscribe/route.ts` | MODIFY | Add `ref` handling, referral code generation, attribution |
| 9 | `src/app/api/checkout/route.ts` | MODIFY | Accept `coupon` query param for Stripe discounts |
| 10 | `src/app/api/cron/publish/route.ts` | MODIFY | Add `verifyPendingReferrals()` call, premium unlock partitioning |
| 11 | `src/app/api/cron/crypto-publish/route.ts` | MODIFY | Add `verifyPendingReferrals()` call, premium unlock partitioning |
| 12 | `src/lib/marketing/email-dispatch.ts` | MODIFY | Replace cross-sell banner with referral widget |
| 13 | `src/lib/marketing/welcome-drip.ts` | MODIFY | Add referral mention to step 2 paragraphs |
| 14 | `src/app/emails/page.tsx` | MODIFY | Read `ref` from URL, pass to subscribe, show referral CTA on success |
| 15 | `src/app/crypto/page.tsx` | MODIFY | Read `ref` from URL, pass to subscribe, show referral CTA on success |
| 16 | `src/app/page.tsx` | MODIFY | Read `ref` from URL, pass to subscribe |

---

## 14. EXECUTION PLAN (suggested order)

1. **Migration** — Create and run `202604170001_create_referral_program.sql`
2. **Referral code generator** — Create `src/lib/referral/generate-referral-code.ts`
3. **Subscribe API** — Add ref param handling, referral code generation, attribution logic
4. **Referral status API** — Create `/api/referral/status/route.ts`
5. **Refer page** — Create `/refer` page
6. **Verification logic** — Create `verify-referrals.ts` and `rewards.ts`
7. **Premium unlock partitioning** — Create `premium-unlock.ts`
8. **Stocks cron** — Add verification call + premium unlock partitioning
9. **Crypto cron** — Add verification call + premium unlock partitioning
10. **Checkout route** — Add coupon param support
11. **Email footer** — Replace cross-sell with referral widget
12. **Welcome drip** — Add referral mention to step 2
13. **Signup pages** — Add ref param reading to `/emails`, `/crypto`, `/`
14. **Test** — Run `npx next build` to verify no type errors
15. **Deploy** — `vercel --prod --yes`
16. **Backfill** — Generate referral codes for all existing subscribers:
    ```sql
    -- Run in Supabase SQL editor after deploy
    UPDATE public.free_subscribers
    SET referral_code = substr(md5(random()::text), 1, 8)
    WHERE referral_code IS NULL AND status = 'active';
    ```

---

## 15. THINGS TO WATCH OUT FOR

1. **Referral code uniqueness**: The `referral_code` column has a UNIQUE constraint. The `generateReferralCode()` function uses `crypto.randomBytes` with 36^8 combinations. Collision probability is negligible at any reasonable subscriber count. If an insert fails due to collision, retry once with a new code.

2. **Self-referral prevention**: The subscribe API must check `referrer.email !== referredEmail` before creating the referral. Also block if the referrer's status is not `active`.

3. **Double attribution**: The `referred_email` column in `referrals` has a UNIQUE constraint. A subscriber can only be attributed to one referrer, ever. First-come-first-served.

4. **Premium unlock timing**: The `premium_unlock_expires_at` check happens at email dispatch time, not at a cron level. This means the subscriber's tier is effectively dynamic — they might get premium content today but free content next week if the unlock expired. This is correct behavior.

5. **Shadow mode**: All referral-related emails (reward notifications) should respect `SHADOW_RUN_EMAIL`. Use the same `getShadowRunRecipient()` pattern from `email-dispatch.ts`.

6. **Stripe coupon security**: The coupon IDs are generated server-side and are one-time use (`max_redemptions: 1`). Even if a coupon URL leaks, it can only be redeemed once. The metadata on the coupon includes the referrer email for audit.

7. **Rate limiting the status endpoint**: The `/api/referral/status` endpoint exposes subscriber data. Without auth, anyone can look up referral stats by email. The email masking in the response mitigates PII exposure. For MVP, this is acceptable. Future improvement: require email + referral code as a lightweight auth pair.

8. **Existing subscribers**: The backfill SQL in step 16 generates referral codes for all existing active subscribers. This means existing subscribers can start referring immediately after deploy, even if they signed up before the referral program existed.

9. **sessionStorage for ref param**: Using sessionStorage means the ref param persists across page navigations within the same browser tab. If a user opens `/emails?ref=abc123`, navigates to `/pricing`, then comes back to `/emails` and subscribes, the ref is still captured. But it does NOT persist across tabs or sessions. This is intentional — we want referral attribution to be session-scoped, not permanent cookie-based.

10. **Do not send referral widget to premium subscribers**: The referral widget in the email footer should only appear in free-tier emails. Premium subscribers already have full access — the "unlock 7 days of premium" pitch makes no sense for them. Wrap the referral widget HTML in a tier check. Premium emails should keep the existing footer (just the unsubscribe link).

---

## 16. ACCEPTANCE CRITERIA

- [ ] New subscriber without `ref` param → gets a referral code, no referral attribution
- [ ] New subscriber with valid `ref` param → referral created as `pending`, `referred_by` set
- [ ] Self-referral (ref points to own email) → blocked, no referral created
- [ ] Invalid/expired ref code → subscription still succeeds, no referral created
- [ ] Already-referred email with different ref → first referral preserved, second blocked
- [ ] Pending referral + referred subscriber receives first daily email → referral becomes `verified`
- [ ] Referrer hits 3 verified → `premium_unlock_expires_at` set to 7 days from now
- [ ] Referrer hits 7 verified → Stripe coupon emailed for 1 free month
- [ ] Referrer hits 15 verified → Stripe coupon emailed for free annual
- [ ] Unlocked free subscriber → receives full briefing (not paywalled) in both stocks and crypto emails
- [ ] Unlock expires after 7 days → subscriber reverts to paywalled free content
- [ ] `/refer` page loads, shows referral link, copy button works
- [ ] `/refer` page shows accurate verified/pending counts and reward tier status
- [ ] Recent referrals list shows masked emails only
- [ ] `?ref=abc123` on `/emails`, `/crypto`, `/` → captured in sessionStorage and sent to subscribe API
- [ ] Success message on signup pages includes referral program link
- [ ] Free-tier email footer contains referral widget
- [ ] Premium-tier email footer does NOT contain referral widget
- [ ] Welcome drip step 2 mentions referral program
- [ ] Analytics events fire for all referral funnel steps
- [ ] `npx next build` succeeds with no type errors
- [ ] Deploy to Vercel succeeds

---

## 17. WHAT NOT TO DO

- Do NOT build a full auth system for the refer page — email lookup is sufficient for MVP
- Do NOT create a "manage referrals" admin dashboard — query the database directly
- Do NOT add referral program mentions to welcome drip steps 1, 3, or 4
- Do NOT make referral codes permanent URLs (like `/r/abc123`) — use query params on existing pages
- Do NOT pay cash per referral — milestone rewards only
- Do NOT require email verification before generating a referral code — every subscriber gets one
- Do NOT add referral widgets to premium email footers
- Do NOT create a separate referral-specific landing page variant — the existing `/emails` page handles `?ref=` seamlessly
- Do NOT add WebSocket or real-time updates to the refer page — a simple fetch on load is enough
- Do NOT modify the Stripe billing plans — use one-time coupons for rewards
- Do NOT add a leaderboard — this creates perverse incentives (spam referrals)
- Do NOT expire referral codes — they work forever
- Do NOT add social sharing buttons (Twitter, Facebook, etc.) — the copy-link pattern is cleaner and platform-agnostic
