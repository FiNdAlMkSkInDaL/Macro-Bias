# Grok publishing experiment, 21–26 October 2026

The user authorized useful, authentic automatic Reddit and X publishing on 21 October. The existing Grok routines were changed from draft-only. Their original experiment end remains 26 October. The Codex recurring chat prompt remains paused.

## X access and the limited server publisher

Grok's existing official X connector is read-only. The website's preexisting API credentials authenticated as `macro_bias` in a read-only check on 21 October; successful authentication does not itself prove that the API will accept a post. Browser scripting is prohibited by [X's automation rules](https://help.x.com/en/rules-and-policies/x-automation).

`/api/marketing/grok-x` is a narrowly scoped alternative. It has no cron and cannot run by itself. It stays disabled unless production has BOTH `GROK_X_PUBLISH_ENABLED=true` and a distinct `GROK_X_PUBLISH_TOKEN` of at least 32 characters. Provisioning that token and giving it to MB X grants new publishing access and requires the owner's explicit confirmation. Do not give Grok the X credentials, service-role key, cron secret or private analytics access. Deployment alone does not enable posting.

The token only permits previewing and requesting a fixed, factual standalone post on `@macro_bias`. The server verifies account identity and sets a direct tracked link. It cannot accept arbitrary text, URLs, replies, mentions, DMs, account changes or subscriber data. No paid briefing prose is read.

The 21 October editorial revision replaces score dumps with `market_context_v2`: lead with an understandable market observation, support it with verified completed-session ETF/coin moves, and give a specific next-session comparison or trend reference to watch. Stocks compare the S&P 500 ETF SPY and Nasdaq-100 ETF QQQ; a correctly dated 20-session average may provide a concrete reference. Crypto compares Bitcoin and Ethereum, without generalizing them to all altcoins or inventing flows, news or causes. An unfamiliar reader must learn something without clicking. Dates label evidence, not the hook; model scores and generic caveats cannot substitute for useful content. Grok must skip any preview that fails this usefulness check.

Quotes must include positive current/prior closes, matching ticker/session labels and consistent returns. Stock inputs must name the last completed weekday; crypto must name yesterday's completed UTC session. Missing, mismatched, stale or oversized content prevents publishing rather than falling back to numbers or filler. The stock holiday policy deliberately skips an unavailable prior-weekday close. Preview metadata records `marketDataDate` separately from model publication date. Do not call these intraday observations. The original stock post remains historical delivery evidence and consumes its weekly slot; this revision does not edit/delete it, reset claims, or send a second post.

The publisher expires at 27 October 00:00 UTC. Stocks can publish Tuesday, with a single 21 October initialization exception; crypto can publish Friday. A deterministic database primary-key claim per market/week limits all callers together to one stock and one crypto post per week. Claims precede API calls. A timeout or failed receipt update remains unresolved and prevents automatic retries; an owner must inspect the remote timeline. Never delete a claim and blindly resend. The legacy queues and Bluesky chart job are unchanged.

After the owner approves access, provision a random 32+ byte token in production and the MB X bot's private runtime configuration, never in a saved routine prompt, repository, chat transcript, public URL or logs. If Grok cannot accept it securely, keep the gate closed and hand off secure credential entry to the owner. No new X app, permission expansion, paid subscription or API credit purchase is authorized by this implementation.

MB X uses an ordinary authenticated HTTP client through its computer, not X's browser UI:

1. `GET https://www.macro-bias.com/api/marketing/grok-x?market=stocks` (or `crypto`) with the private bearer token in the Authorization header. This only previews and never claims/sends.
2. Check that the returned dated comparison is useful, accurate and appropriate. If not, skip. The caller cannot replace the copy.
3. `POST` the same URL without a query, with the same bearer header, JSON Content-Type, and exactly `{ "market": "stocks", "fingerprint": "<preview fingerprint>" }`.
4. Log the returned permalink. `already_published` means no new send; 409 needs inspection, not a retry loop. A changed preview requires a fresh read and review. Any provider/credit/access failure stops, with no browser fallback or purchase.

## Reddit

`MB Reddit gated publishing (12–26 Oct experiment)` retains Thursday 15:05 Europe/London, max two useful contributions per week with equal stocks/crypto intent, where permitted. Its check found no App label/developer registration, no written commercial approval and no approved access method for the existing account. It is BLOCKED, not live. The saved gate reads the bot's `reddit-approval.md` before any Reddit collection or posting. It stops on unchanged missing evidence, rather than repeatedly browsing or drafting. Morning/evening routines and r/Trading remain paused.

[Reddit's Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) requires registered transparent app accounts, approved access and explicit written commercial approval. The [spam policy](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam) and each community's rules also apply. User permission and a browser login do not replace those requirements. No approval application, moderator outreach, new account, historic comment edit or deletion was performed.

After those gates pass, the routine must record dated community-rule evidence and allowed contexts; disclose automation and Macro Bias affiliation; contribute a complete answer without requiring a click; add a link only where expressly allowed; invent no trading/lived experience; avoid promotional repetition; stop on any restriction/removal or uncertain outcome. No quota-filling, unsolicited DMs, karma manipulation or evasion.

## Subscriber acquisition

The website already captures consent-aware attribution continuously, independently of this chat. Both bots preserve `utm_source=x` or `reddit`, `utm_medium=organic_social`, the existing `mb_growth_202610_stocks_backdrop` / `mb_growth_202610_crypto_context` campaigns and a unique dated `utm_content`. The limited X publisher uses `grok_<market>_<YYYYMMDD>`. Successful API publication is delivery evidence, not subscriber evidence.

Run `node scripts/report-grok-acquisition.cjs` with the existing authorized local environment to read first-touch aggregates since 21 October, separated by source, campaign and post content. It performs no writes. Original stocks/crypto/both/unknown opt-ins retain existing genuine-growth exclusions and deduplication. Latest touch, if separately read, is an assist and is never added. Incomplete data has null metrics; absent attribution and consent gaps do not establish zero real people or direct traffic. Do not create test visitors/subscribers. The bots have no database credentials and cannot invent subscriber results.

Pre-configuration baseline at 21 October 10:48 UTC, cumulative since 12 October: 73 tracked views, four consent-identified visitors, one newsletter subscriber choosing both from InboxReads, one account with unknown source, no recorded Reddit/X acquisition or verified first paid conversion. This is not evidence of new publishing performance.

Validation: `node scripts/verify-grok-x-publishing.cjs`, `npm run verify:analytics`, `npm run verify:distribution`, `npm run typecheck`, `npm run build`. Offline verification never posts. Production preview requires the scoped token; do not invoke a live publisher as a smoke test.
