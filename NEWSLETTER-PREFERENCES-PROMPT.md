# Newsletter Preference System: Full Implementation Brief

You are adding **newsletter preference support** to an existing production product called Macro Bias (macro-bias.com). The product already sends two separate daily email briefings — one for stocks and one for crypto — but there is no UI for users to choose which ones they want. Your job is to wire up preference selection at signup, add tiered content (free preview vs full) to the crypto email, filter the stocks email by preference, and update the welcome drip to reflect chosen preferences.

Read this entire document before writing any code. Then create a detailed plan. Then execute.

---

## 1. THE EXISTING SYSTEM

### Architecture
- **Framework**: Next.js 15 (App Router), deployed on Vercel Hobby plan
- **Database**: Supabase (Postgres)
- **Email**: Resend API, from `Macro Bias <briefing@macro-bias.com>`
- **Billing**: Stripe ($25/mo or $190/yr), 7-day free trial
- **Crons** (vercel.json):
  - `/api/cron/publish` at 12:45 UTC — stocks briefing
  - `/api/cron/crypto-publish` at 13:00 UTC — crypto briefing
  - `/api/cron/welcome-drip` at 10:00 UTC — drip emails
  - `/api/cron/social-dispatch` at 17:00 UTC — social posts

### Current Database Schema (`free_subscribers` table)

```sql
email       text PRIMARY KEY
status      text NOT NULL DEFAULT 'active'   CHECK (status IN ('active', 'inactive'))
tier        text NOT NULL DEFAULT 'free'     CHECK (tier IN ('free'))
crypto_opted_in boolean NOT NULL DEFAULT false
created_at  timestamptz
updated_at  timestamptz
```

The `crypto_opted_in` column already exists but has **no UI toggle** — it can only be set manually in the database. There is no `stocks_opted_in` column; currently all active free subscribers receive the stocks email.

### Current Email Flows

**Stocks publish cron** (`src/app/api/cron/publish/route.ts`):
- Calls `getTieredQuantBriefingRecipients()` which returns two lists:
  - **Premium**: from `users` table where `subscription_status IN ('active', 'trialing')`
  - **Free**: from `free_subscribers` where `status = 'active' AND tier = 'free'`, excluding anyone already in the premium list
- Premium recipients get the full briefing
- Free recipients get a preview with `🔒 [LOCKED]` markers and a paywall CTA
- Monday emails include a weekly digest recap
- Uses `dispatchQuantBriefing()` from `src/lib/marketing/email-dispatch.ts` which handles batching, shadow mode, unsubscribe links, etc.

**Crypto publish cron** (`src/app/api/cron/crypto-publish/route.ts`):
- Queries `free_subscribers WHERE status = 'active' AND crypto_opted_in = true`
- Sends the **full** briefing to ALL crypto subscribers — **no tiered content, no free/premium split**
- Has its own inline HTML builder (`buildCryptoBriefingEmailHtml`) and email dispatch (`dispatchCryptoBriefingEmails`)
- Sends via `resend.emails.send()` in batches of 50
- Does NOT use per-recipient unsubscribe links (sends to batch `to:` field)
- Subject format: `[CRYPTO] RISK ON (+42) — Daily Crypto Bias`

**Subscribe endpoint** (`src/app/api/subscribe/route.ts`):
- Accepts `POST { email, pagePath }`
- Upserts into `free_subscribers` with `status: 'active', tier: 'free'`
- Enrolls in welcome drip + dispatches first welcome email immediately
- Does NOT accept any preference fields — no `stocksOptedIn` or `cryptoOptedIn`

**Welcome drip** (`src/lib/marketing/welcome-drip.ts`):
- 4-step sequence: day 0 (immediate), day 1, day 3, day 7
- All content is stocks-focused (mentions SPY, S&P 500, sector breakdown, +286% track record)
- No mention of crypto anywhere in the drip

**Signup page** (`src/app/emails/page.tsx`):
- Client component with email input form
- Posts to `/api/subscribe`
- Shows stocks-only content: +286% vs +111% SPY, sector breakdown description
- No checkboxes for newsletter preference

### Current Pricing Tiers

| Feature | Free | Pro ($25/mo) |
|---------|------|--------------|
| Daily macro regime score | ✓ | ✓ |
| Top-line market summary | ✓ | ✓ |
| Regime classification | ✓ | ✓ |
| Daily email briefing | Preview only | Full |
| Sector breakdown | — | ✓ |
| Historical pattern analysis | — | ✓ |
| Cross-asset heatmap | — | ✓ |
| Intraday playbook | — | ✓ |
| Risk check & model notes | — | ✓ |
| Weekly regime recap | — | ✓ |

Crypto is not mentioned in the pricing page at all.

---

## 2. WHAT YOU ARE BUILDING

### Design Decisions (already made, do not change)

1. **Two separate emails, not one combined** — stock traders don't want crypto noise and vice versa
2. **Preference checkboxes at signup** — Stocks and Crypto, both checked by default
3. **One paid tier covers everything** — Pro ($25/mo) unlocks full content for both stocks and crypto
4. **Free tier gets preview of both** — same `🔒 [LOCKED]` treatment for crypto as stocks already has
5. **No new Stripe plans** — the existing monthly/annual plan stays the same

### What Needs to Change

| # | Area | Change |
|---|------|--------|
| 1 | Database | Add `stocks_opted_in boolean NOT NULL DEFAULT true` column to `free_subscribers` |
| 2 | Signup page | Add Stocks/Crypto toggle checkboxes (both on by default) |
| 3 | Subscribe API | Accept `{ stocksOptedIn, cryptoOptedIn }` and write to DB |
| 4 | Stocks publish cron | Filter free recipients by `stocks_opted_in = true` |
| 5 | Crypto publish cron | Add tiered content (free=preview, pro=full) matching stocks pattern |
| 6 | Welcome drip | Mention crypto if `crypto_opted_in = true` |
| 7 | Pricing page | Add crypto features to the Pro tier list |

---

## 3. DATABASE MIGRATION

Create file: `supabase/migrations/202604160001_add_stocks_opted_in.sql`

```sql
-- Add stocks_opted_in column to free_subscribers
-- Defaults to true so all existing subscribers continue receiving stocks emails
ALTER TABLE public.free_subscribers
  ADD COLUMN IF NOT EXISTS stocks_opted_in boolean NOT NULL DEFAULT true;
```

After creating the migration file, run it against the live Supabase database:
```
npx supabase db push
```
If that doesn't work (Hobby plan sometimes doesn't have CLI linked), run the SQL directly in the Supabase SQL editor. You can verify by checking the table schema in Supabase.

---

## 4. FILE-BY-FILE CHANGES

### 4.1 `src/app/emails/page.tsx` (REWRITE)

Current: Simple email input, stocks-only messaging.

New behavior:
- Add two checkbox inputs below the email field: "Stocks" and "Crypto", both checked by default
- Update the form to POST `{ email, pagePath, stocksOptedIn, cryptoOptedIn }` to `/api/subscribe`
- Update the hero stat block to show BOTH track records side by side:
  - Stocks: `+286% Macro Bias vs +111% S&P 500` (existing)
  - Crypto: `+41,576% Long Only vs +944% BTC` (new)
  - Link stocks stat to `/track-record`, crypto stat to `/crypto/track-record`
- Update "What you get" bullets to include a crypto bullet when crypto is checked
- Update the sample briefing section to show a tabbed preview (Stocks / Crypto) or just mention both
- Keep the same design language: dark theme, zinc colors, monospace data font

Checkbox styling should match the existing design: minimal, dark, with zinc-500/white text. Something like:

```tsx
<div className="mx-auto mt-4 flex max-w-xl items-center justify-center gap-6">
  <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
    <input
      type="checkbox"
      checked={stocksOptedIn}
      onChange={(e) => setStocksOptedIn(e.target.checked)}
      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-white accent-white"
    />
    Stocks
  </label>
  <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
    <input
      type="checkbox"
      checked={cryptoOptedIn}
      onChange={(e) => setCryptoOptedIn(e.target.checked)}
      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-white accent-white"
    />
    Crypto
  </label>
</div>
```

Require at least one checkbox to be checked before allowing form submission. Show a subtle validation message if both are unchecked.

### 4.2 `src/app/api/subscribe/route.ts` (MODIFY)

Current: Accepts `{ email, pagePath }`, upserts with defaults.

Changes:
- Accept optional `stocksOptedIn` (boolean, default `true`) and `cryptoOptedIn` (boolean, default `false`) in the request body
- Pass these to the upsert:

```ts
const { error } = await supabase.from('free_subscribers').upsert(
  {
    email,
    status: 'active',
    tier: 'free',
    stocks_opted_in: stocksOptedIn,
    crypto_opted_in: cryptoOptedIn,
  },
  {
    onConflict: 'email',
  },
);
```

Important: On conflict (returning subscriber), this will UPDATE their preferences. This is the desired behavior — if someone re-subscribes, they get the new preferences they selected.

Add type for the request body:
```ts
type SubscribeRequestBody = {
  email?: unknown;
  pagePath?: unknown;
  stocksOptedIn?: unknown;
  cryptoOptedIn?: unknown;
};
```

Add a helper to safely parse boolean preference:
```ts
function parseBooleanPreference(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return defaultValue;
}
```

### 4.3 `src/app/api/cron/publish/route.ts` (MODIFY)

Current: `getTieredQuantBriefingRecipients()` fetches all active free subscribers.

Change: Add `.eq('stocks_opted_in', true)` to the free subscribers query.

Find the query that looks like:
```ts
.from('free_subscribers')
.select('email, status, tier')
.eq('status', 'active')
.eq('tier', 'free')
```

Add one line:
```ts
.from('free_subscribers')
.select('email, status, tier')
.eq('status', 'active')
.eq('tier', 'free')
.eq('stocks_opted_in', true)
```

That's the only change to this file. Premium users (from `users` table) always get the stocks email regardless — they pay for everything.

### 4.4 `src/app/api/cron/crypto-publish/route.ts` (MAJOR REWRITE of email dispatch)

Current: Sends the full briefing to all `crypto_opted_in = true` subscribers. No tiering.

New behavior:
- Query premium recipients from `users` table (same as stocks publish does)
- Query free crypto recipients from `free_subscribers WHERE status = 'active' AND crypto_opted_in = true`, excluding premium users
- Build TWO versions of the email:
  - **Premium**: Full briefing (all 4 sections: BOTTOM LINE, MARKET BREAKDOWN, RISK CHECK, MODEL NOTES)
  - **Free**: Preview only — show BOTTOM LINE + first bullet of MARKET BREAKDOWN, then `🔒 [LOCKED]` paywall CTA
- Send premium emails first, then free emails
- Add per-recipient unsubscribe links (currently missing — it sends to batch `to:`)
- Use `resend.batch.send()` like the stocks dispatch does, not `resend.emails.send()`

**Free tier crypto email HTML**: The existing `buildCryptoBriefingEmailHtml` function builds the full HTML. Create a new variant `buildFreeTierCryptoBriefingEmailHtml` that:
1. Shows the header (score, label) — same as premium
2. Shows the BOTTOM LINE section — same as premium
3. Shows only the first bullet of MARKET BREAKDOWN (if it has bullets) or first paragraph
4. Replaces remaining sections with a paywall block:
```html
<div style="border: 1px solid #38bdf8; border-radius: 12px; padding: 24px; background: linear-gradient(135deg, rgba(56,189,248,0.12) 0%, rgba(9,9,11,0.96) 60%);">
  <p style="color: #7dd3fc; font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase;">Premium Access Required</p>
  <p style="margin: 12px 0 0; color: #f8fafc; font-size: 18px; font-weight: 700;">Unlock the full crypto briefing with market breakdown, risk check, and model notes.</p>
  <a href="{{UPGRADE_URL}}" style="display: inline-block; margin-top: 16px; padding: 12px 24px; background: #0ea5e9; color: #fff; text-decoration: none; font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; border-radius: 8px;">START 7-DAY FREE TRIAL</a>
</div>
```
5. Updates the footer to say "You're receiving this because you opted into Crypto Briefings" and includes per-recipient unsubscribe link

**Implementation approach**: The cleanest way is to refactor `dispatchCryptoBriefingEmails` to accept a `tier` parameter and build the appropriate HTML. Model it on how `dispatchQuantBriefing` in `email-dispatch.ts` works.

### 4.5 `src/lib/marketing/welcome-drip.ts` (MINOR MODIFY)

Current: All 4 welcome emails are stocks-only. The first email mentions "+286% vs SPY" and "sector breakdown".

Change: In `WELCOME_DRIP_STEPS[0]` (the immediate welcome email, `dayOffset: 0`):

1. The `summary` field should mention crypto if applicable. But since the drip steps are static constants and we don't have subscriber context at definition time, we need to make them dynamic.

**Approach**: Add a function `getPersonalizedWelcomeStep(step, subscriber)` that customizes copy based on preferences. For the first step:

- If `stocks_opted_in && crypto_opted_in`:
  - Add a bullet: `"Plus: daily crypto regime scoring for BTC — same discipline, tuned for crypto volatility."`
  - Update summary to mention both: `"Every morning you will get the market's directional bias for stocks — and if you opted in, a separate crypto briefing too."`

- If `crypto_opted_in && !stocks_opted_in`:
  - Replace stock-specific bullets with crypto ones
  - Change CTA to point to `/crypto/track-record`
  - Update stats from SPY to BTC

- If `stocks_opted_in && !crypto_opted_in`:
  - No change (current behavior)

The personalization should be applied at email render time, not at step definition time. The simplest approach: in the function that builds the welcome email HTML, look up the subscriber's preferences from `free_subscribers` and adjust the copy.

**Do NOT rewrite all 4 drip steps.** Only personalize step 1 (the welcome email). Steps 2-4 are general enough to apply to both audiences.

### 4.6 `src/app/pricing/page.tsx` (MINOR MODIFY)

Current: Feature list only mentions stocks features.

Change: Add crypto features to the Pro tier:

Add these items to the Pro features list:
- `Daily crypto regime score & briefing` (in Free column: "Preview")
- `Full crypto market breakdown` (in Free column: "—")

This makes it clear that Pro covers both stocks and crypto.

### 4.7 `src/app/api/subscribe/unsubscribe/route.ts` (VERIFY — likely no changes)

The unsubscribe endpoint sets `free_subscribers.status = 'inactive'`. This already stops both stocks and crypto emails since both check `status = 'active'`. No changes needed here.

If you want to add a future "manage preferences" page, that's a separate project. For now, unsubscribe = stop everything.

---

## 5. WHAT TO REUSE VS WHAT TO CREATE NEW

| Component | Action |
|-----------|--------|
| `free_subscribers` table | Reuse — add `stocks_opted_in` column |
| `users` table | Reuse as-is — premium users get everything |
| `getTieredQuantBriefingRecipients()` in publish cron | Modify — add `.eq('stocks_opted_in', true)` |
| `dispatchQuantBriefing()` in `email-dispatch.ts` | Reuse as-is — stocks email dispatch stays the same |
| `createQuantBriefingEmailContent()` in `email-dispatch.ts` | Reuse as-is — stocks email content stays the same |
| `buildCryptoBriefingEmailHtml()` in crypto-publish | Modify — add free-tier variant |
| `dispatchCryptoBriefingEmails()` in crypto-publish | Rewrite — add tiered dispatch with premium/free split |
| Welcome drip steps | Modify step 1 only — add crypto mention if opted in |
| Subscribe API | Modify — accept preference fields |
| Signup page | Rewrite — add checkboxes and crypto messaging |
| Pricing page | Modify — add crypto feature rows |
| Unsubscribe endpoint | No change |
| Stripe plans | No change |

---

## 6. CURRENT CODE REFERENCE

### Subscribe endpoint (`src/app/api/subscribe/route.ts`)

The upsert currently looks like:
```ts
const { error } = await supabase.from('free_subscribers').upsert(
  {
    email,
    status: 'active',
    tier: 'free',
  },
  {
    onConflict: 'email',
  },
);
```

### Stocks publish free subscriber query (`src/app/api/cron/publish/route.ts`, line ~360)

```ts
const { data, error } = await supabase
  .from('free_subscribers')
  .select('email, status, tier')
  .eq('status', 'active')
  .eq('tier', 'free')
  .order('email', { ascending: true })
  .range(offset, offset + EMAIL_RECIPIENT_PAGE_SIZE - 1);
```

### Crypto publish subscriber query (`src/app/api/cron/crypto-publish/route.ts`, line ~255)

```ts
const { data: subscribers, error } = await supabase
  .from("free_subscribers")
  .select("email")
  .eq("status", "active")
  .eq("crypto_opted_in", true);
```

### Crypto email dispatch (current — no tiering, no per-recipient unsub)

```ts
async function dispatchCryptoBriefingEmails(
  newsletterCopy: string,
  score: number,
  label: BiasLabel,
) {
  // ...loads all crypto_opted_in subscribers
  // ...sends via resend.emails.send() to batch
  // ...no free/premium split
  // ...no per-recipient unsubscribe links
}
```

### Stocks email dispatch (the pattern to follow — in `email-dispatch.ts`)

```ts
export async function dispatchQuantBriefing(
  newsletterCopy: string,
  score: number,
  label: string,
  isOverrideActive: boolean,
  options: DispatchQuantBriefingOptions,  // { recipients, tier, weeklyDigest }
): Promise<DispatchQuantBriefingResult> {
  // ...applies shadow run override
  // ...builds email content via createQuantBriefingEmailContent() with tier
  // ...sends via resend.batch.send() with per-recipient unsubscribe links
  // ...returns { batchCount, emailIds, recipientCount }
}
```

The stocks publish cron calls this twice:
```ts
// Premium
await dispatchQuantBriefing(copy, score, label, override, {
  recipients: premiumRecipients,
  tier: 'premium',
  weeklyDigest,
});

// Free
await dispatchQuantBriefing(copy, score, label, override, {
  recipients: freeRecipients,
  tier: 'free',
  weeklyDigest,
});
```

### Signup page (`src/app/emails/page.tsx`)

Client component with simple email form. Posts `{ email, pagePath }` to `/api/subscribe`. Currently stocks-only messaging. Full file is 164 lines.

---

## 7. EXECUTION PLAN (suggested order)

1. **Migration** — Create and run `202604160001_add_stocks_opted_in.sql`
2. **Subscribe API** — Add `stocksOptedIn` / `cryptoOptedIn` to request body parsing and upsert
3. **Signup page** — Add checkboxes, update messaging and stats
4. **Stocks publish cron** — Add `.eq('stocks_opted_in', true)` filter
5. **Crypto publish cron** — Add tiered dispatch (free preview + premium full), premium recipient query, per-recipient unsubscribe links
6. **Welcome drip** — Personalize step 1 based on preferences
7. **Pricing page** — Add crypto rows to feature table
8. **Test** — Run `npx next build` to verify no type errors, then deploy

---

## 8. THINGS TO WATCH OUT FOR

1. **Backward compatibility**: All existing `free_subscribers` rows have `stocks_opted_in = true` (the default) and `crypto_opted_in = false`. This means existing subscribers keep getting stocks emails and don't get crypto emails. New subscribers who check both boxes get both. This is correct.

2. **Premium users always get everything**: The `users` table (Stripe subscribers) does not have opt-in columns. Premium users receive both stocks and crypto emails regardless of any `free_subscribers` row they may also have. The stocks cron already handles this by querying `users` separately. The crypto cron needs to be updated to do the same.

3. **Shadow mode**: The stocks email dispatch has `SHADOW_RUN_EMAIL` support (redirects all emails to one address for testing). The crypto dispatch does not. You should add it for consistency — use the same `process.env.SHADOW_RUN_EMAIL` pattern.

4. **Per-recipient unsubscribe**: The stocks dispatch builds unique unsubscribe URLs per recipient. The crypto dispatch currently sends to a batch `to:` array with no per-recipient unsubscribe. This is a CAN-SPAM compliance issue. Fix it by switching to `resend.batch.send()` like stocks does.

5. **Don't break the existing upsert**: The subscribe API upserts on conflict. Adding `stocks_opted_in` and `crypto_opted_in` to the upsert means re-subscribing updates preferences. This is intentional — but make sure you don't accidentally set `crypto_opted_in = false` for existing subscribers who re-subscribe without the crypto checkbox (e.g., from an old cached page). Handle this by only including preference fields in the upsert if they are explicitly provided in the request body.

6. **At least one newsletter required**: The signup form should require at least one of Stocks or Crypto to be checked. Don't allow someone to subscribe with both unchecked.

7. **The crypto email HTML builder is inline**: Unlike stocks (which uses the shared `email-dispatch.ts`), the crypto email HTML is built directly in the cron route file. Keep it there for now — don't try to refactor it into `email-dispatch.ts`. Just add the free-tier variant alongside the existing full version.

---

## 9. ACCEPTANCE CRITERIA

- [ ] New subscriber with both checkboxes → gets stocks AND crypto emails
- [ ] New subscriber with only Stocks → gets stocks email only, no crypto
- [ ] New subscriber with only Crypto → gets crypto email only, no stocks
- [ ] Existing subscribers (before migration) → continue getting stocks only (unchanged behavior)
- [ ] Free crypto email → shows BOTTOM LINE + first MARKET BREAKDOWN bullet + paywall CTA
- [ ] Premium crypto email → shows all 4 sections (unchanged from current)
- [ ] Premium users → get BOTH emails regardless of `free_subscribers` preferences
- [ ] Signup page → shows Stocks/Crypto checkboxes, both checked by default
- [ ] Signup page → shows track record stats for both stocks (+286% vs SPY) and crypto (+41,576% vs BTC)
- [ ] Pricing page → lists crypto features in Pro tier
- [ ] Welcome email (step 1) → mentions crypto if subscriber opted in
- [ ] Unsubscribe → stops all emails (both stocks and crypto)
- [ ] Per-recipient unsubscribe links in crypto emails
- [ ] `npx next build` succeeds with no type errors
- [ ] Deploy to Vercel succeeds

---

## 10. WHAT NOT TO DO

- Do NOT create a separate Stripe plan for crypto
- Do NOT create a separate "manage preferences" page (future scope)
- Do NOT refactor the crypto email builder into `email-dispatch.ts` (keep it in the cron route)
- Do NOT change the stocks email content or format
- Do NOT change cron schedules
- Do NOT add new database tables — only add one column to `free_subscribers`
- Do NOT modify the welcome drip steps 2-4 — only personalize step 1
- Do NOT add a crypto weekly digest (future scope)
- Do NOT change the unsubscribe behavior (unsubscribe = stop everything)
