# Full briefing access

Scores, dated readings and published briefing listings remain public. Full body text, model notes and news context require either a signed-in Pro entitlement or a signed-in Free account after release. Active/trialing subscriptions and `profiles.is_pro` use the existing Pro resolver.

Release occurs inclusively when the server's UTC clock is at or after first publication plus seven complete calendar days (168 hours). For example, a post first published September 25 at 12:45:27.119 UTC opens to signed-in Free accounts October 2 at 12:45:27.119 UTC. Weekends count; trading sessions, browser clocks and local daylight-saving changes do not affect age. Missing or invalid timestamps never release to Free.

Stock publishing inserts records. The earliest actual `daily_market_briefings.generated_at` across every saved version of a `briefing_date` determines first publication; the latest version supplies the article. Crypto uses `crypto_daily_briefings.created_at`; its regeneration upsert does not supply or update that column. `updated_at`, briefing labels and source-session dates never determine age. Neither release calculation fabricates a timestamp or restarts age on regeneration.

Metadata-only reads supply listings, gates and search/social previews. The server evaluates the viewer and age before fetching a full body or model column. Dynamic article routes and request-local React caching avoid sharing authorized body data across users. Public JSON/RSS feeds contain only scores, dates and access information. Anonymous eligible articles lead to sign-in with the exact article as the return destination; newer articles lead to Pro and display their Free release timestamp.

Existing database migrations enable and force briefing-table RLS and revoke direct anonymous/authenticated table access. Verify the connected database's REST reads independently when deploying; source migrations alone do not establish connected database state. This change does not modify or deploy database policies.
