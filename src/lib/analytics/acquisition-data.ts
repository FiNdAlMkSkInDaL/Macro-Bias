import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSource } from "@/lib/analytics/attribution";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Keep private delivery claims, reset rate limits, email diagnostics and paper
// trading records outside this query. Never replace this with a broad exclusion.
export const ACQUISITION_EVENT_NAMES = [
  "page_view", "visitor_identified", "email_subscribed", "account_created", "paid_conversion",
] as const;

const DAY_MS = 86_400_000;
const PAGE_SIZE = 500;
const MAX_EVENT_ROWS = 25_000;
const MAX_ENTITY_ROWS = 10_000;
const QUERY_TIMEOUT_MS = 8_000;
const DATASET_TIMEOUT_MS = 20_000;
const INTERNAL_HOSTS = new Set(["macro-bias.com", "www.macro-bias.com", "checkout.stripe.com", "billing.stripe.com"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_PATH = /^\/(?:analytics|api|account|alerts|auth|dashboard|test|admin|login|signup|sign-up|sign-in|forgot-password|reset-password|update-password|checkout|billing)(?:\/|$)/i;
const BOT_OR_TEST = /bot|spider|crawler|headless|playwright|puppeteer|synthetic|monitoring/i;

export type AcquisitionFilters = {
  preset?: "7d" | "30d" | "90d" | "custom";
  start?: string;
  end?: string;
  source?: string;
  campaign?: string;
  touch?: "first" | "latest";
};

export type AcquisitionRange = {
  startDate: string;
  endDate: string;
  startInclusive: string;
  endExclusive: string;
  timezone: "UTC";
};

type Touch = {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  referrerDomain: string | null;
  landingPath: string;
  capturedAt: string | null;
};

export type AcquisitionEventRow = {
  id: string;
  event_name: string;
  created_at: string;
  anonymous_id?: string | null;
  session_id?: string | null;
  page_path?: string | null;
  referrer?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  metadata?: Record<string, unknown> | null;
};

// These identities exist only in server memory. No identity or raw metadata is
// part of AcquisitionReport, which is safe to serialize to the admin UI.
export type AcquisitionSubscriber = {
  entityKey: string;
  createdAt: string;
  status?: string;
  stocksOptedIn?: boolean;
  cryptoOptedIn?: boolean;
};
export type AcquisitionAccount = { entityKey: string; createdAt: string };
export type AcquisitionDatasetCoverage = {
  name: "events" | "subscribers" | "accounts";
  rows: number;
  total: number | null;
  available: boolean;
  complete: boolean;
  error?: string;
};
export type AcquisitionInput = {
  events: AcquisitionEventRow[];
  subscribers: AcquisitionSubscriber[];
  accounts: AcquisitionAccount[];
  datasets?: AcquisitionDatasetCoverage[];
};
export type AcquisitionMetrics = {
  pageViews: number;
  visitors: number;
  sessions: number;
  newSubscribers: number;
  newAccounts: number;
  paidConversions: number;
  subscriberVisitors: number;
  subscriberRate: number | null;
};
export type AcquisitionBreakdown = AcquisitionMetrics & {
  key: string;
  label: string;
  source?: string;
  medium?: string;
  campaign?: string;
};
export type AcquisitionReport = {
  range: AcquisitionRange;
  filters: { preset: NonNullable<AcquisitionFilters["preset"]>; source: string; campaign: string; touch: "first" | "latest" };
  overview: AcquisitionMetrics;
  sourceRows: AcquisitionBreakdown[];
  campaignRows: AcquisitionBreakdown[];
  landingRows: AcquisitionBreakdown[];
  contentRows: AcquisitionBreakdown[];
  dailySeries: (AcquisitionMetrics & { date: string })[];
  funnel: { key: string; label: string; value: number; denominator: number | null; rate: number | null; note: string }[];
  coverage: {
    complete: boolean;
    datasets: AcquisitionDatasetCoverage[];
    warnings: string[];
    identifiedPageViews: number;
    unidentifiedPageViews: number;
    identityCoveragePct: number | null;
    knownSubscriberSources: number;
    unknownSubscriberSources: number;
    knownAccountSources: number;
    unknownAccountSources: number;
    linkedSubscriberCount: number;
    linkedAccountCount: number;
    linkedPaidCount: number;
    unlinkedSubscriberCount: number;
    unlinkedAccountCount: number;
    unlinkedPaidCount: number;
    legacyPageViews: number;
    excludedRows: number;
    excludedReferralOnlyRows: number;
    consentIdentifiedVisits: number;
    paidHistoryAvailable: false;
    truncatedDatasets: string[];
  };
  freshness: { loadedAt: string; latestPageViewAt: string | null; latestConversionAt: string | null };
  options: { sources: string[]; campaigns: string[] };
  definitions: string[];
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown, fallback = "unknown", limit = 128): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const cleaned = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, limit);
  // Older client fields were untrusted. Do not expose an email or a tokenized
  // URL somebody put into a campaign name in a dashboard or its CSV export.
  if (cleaned.includes("@") || /https?:|eyJ[a-zA-Z0-9_-]{20}|(?:access_token|refresh_token|token_hash|code)=/i.test(cleaned)) return "redacted";
  return cleaned;
}
function source(value: unknown, fallback = "unknown") {
  const normalized = text(value, fallback);
  return normalized === "redacted" ? "unknown" : normalizeSource(normalized) ?? "unknown";
}
function medium(value: unknown, fallback = "unknown") {
  const normalized = text(value, fallback);
  return normalized === "redacted" ? "unknown" : normalized.toLowerCase();
}
function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function path(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "/unknown";
  let result = value.trim().split(/[?#]/)[0];
  if (/^https?:\/\//i.test(result)) {
    try { result = new URL(result).pathname; } catch { return "/unknown"; }
  }
  if (!result.startsWith("/") || /%40|@|%0[ad]/i.test(result) || PRIVATE_PATH.test(result)) return "/other";
  if (/^\/(?:r|refer)\//i.test(result)) return "/refer";
  return result.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "/";
}
function domain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const hostname = new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "");
    if (INTERNAL_HOSTS.has(hostname) || hostname === "localhost" || hostname.endsWith(".vercel.app") || hostname.endsWith(".supabase.co")) return null;
    return /^[a-z0-9.-]+$/.test(hostname) ? hostname.slice(0, 128) : null;
  } catch { return null; }
}
function unknownTouch(): Touch {
  return { source: "unknown", medium: "unknown", campaign: "(none)", content: "(none)", referrerDomain: null, landingPath: "/unknown", capturedAt: null };
}
function readTouch(value: unknown): Touch | null {
  const raw = object(value);
  if (!raw || typeof raw.source !== "string" || !raw.source.trim()) return null;
  return {
    source: source(raw.source), medium: medium(raw.medium), campaign: text(raw.campaign, "(none)"),
    content: text(raw.content, "(none)"), referrerDomain: domain(raw.referrerDomain),
    landingPath: path(raw.landingPath), capturedAt: timestamp(raw.capturedAt),
  };
}
function attributionFor(event: AcquisitionEventRow, touch: "first" | "latest", conversion = false) {
  const metadata = event.metadata ?? {};
  const attribution = object(metadata.attribution);
  if (metadata.event_version === 2 && attribution?.version === 2 && metadata.tracking_mode === "consented") {
    const selected = readTouch(attribution[touch === "first" ? "firstTouch" : "latestTouch"]);
    if (selected) return selected;
  }
  if (conversion) return unknownTouch();
  if (metadata.event_version === 2 && metadata.tracking_mode === "aggregate") {
    return readTouch(metadata.aggregate_touch) ?? unknownTouch();
  }
  // Legacy views retain only what was actually recorded. Missing referrer/UTM
  // does not prove a direct visit and is deliberately not reclassified as one.
  const referrerDomain = domain(event.referrer);
  return {
    ...unknownTouch(), source: source(event.utm_source, referrerDomain ?? "unknown"),
    medium: medium(event.utm_medium, referrerDomain ? "referral" : "unknown"),
    campaign: text(event.utm_campaign, "(none)"), referrerDomain,
    landingPath: path(event.page_path),
  };
}
function identities(event: AcquisitionEventRow): { visitor: string | null; session: string | null } {
  const metadata = event.metadata ?? {};
  if (metadata.event_version === 2 && metadata.tracking_mode !== "consented") return { visitor: null, session: null };
  const attribution = object(metadata.attribution);
  const visitor = attribution?.visitorId ?? event.anonymous_id;
  const session = attribution?.sessionId ?? event.session_id;
  return {
    visitor: typeof visitor === "string" && UUID.test(visitor) ? visitor.toLowerCase() : null,
    session: typeof session === "string" && UUID.test(session) ? session.toLowerCase() : null,
  };
}
function excluded(event: AcquisitionEventRow) {
  const metadata = event.metadata ?? {};
  return !ACQUISITION_EVENT_NAMES.includes(event.event_name as typeof ACQUISITION_EVENT_NAMES[number])
    || ["bot", "test", "internal"].includes(String(metadata.traffic_type ?? "").toLowerCase())
    || metadata.is_bot === true || metadata.is_test === true || metadata.test === true
    || BOT_OR_TEST.test(String(metadata.user_agent ?? metadata.userAgent ?? ""))
    || /^(?:test|qa|codex-test)(?:[-_:]|$)/i.test(String(event.utm_source ?? ""))
    || (["page_view", "visitor_identified"].includes(event.event_name) && PRIVATE_PATH.test((event.page_path ?? "").split(/[?#]/)[0]))
    || /(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(event.referrer ?? "");
}
function validDate(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && timestamp(`${value}T00:00:00.000Z`)?.slice(0, 10) === value;
}

export function resolveAcquisitionRange(filters: AcquisitionFilters = {}, now = new Date()): AcquisitionRange {
  const today = now.toISOString().slice(0, 10);
  const preset = filters.preset ?? "30d";
  let startDate: string;
  let endDate = today;
  if (preset === "custom") {
    if (!validDate(filters.start) || !validDate(filters.end)) throw new Error("Choose valid start and end dates.");
    startDate = filters.start;
    endDate = filters.end;
  } else {
    if (!["7d", "30d", "90d"].includes(preset)) throw new Error("Choose a supported date range.");
    const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
    startDate = new Date(Date.parse(`${today}T00:00:00.000Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  }
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (end < start || (end - start) / DAY_MS >= 365 || endDate > today) throw new Error("Use an ordered date range of at most 365 days, ending today or earlier.");
  return { startDate, endDate, startInclusive: new Date(start).toISOString(), endExclusive: new Date(end + DAY_MS).toISOString(), timezone: "UTC" };
}

type Observation = {
  kind: "view" | "identity" | "subscriber" | "account" | "paid";
  at: string;
  touch: Touch;
  visitor: string | null;
  session: string | null;
  contentGroup: string;
  identified: boolean;
  legacy: boolean;
};
type Bucket = {
  pageViews: number; visitors: Set<string>; sessions: Set<string>;
  newSubscribers: number; newAccounts: number; paidConversions: number; subscriberVisitors: Set<string>;
  visitAt: Map<string, string>; subscriberAt: Map<string, string>;
};
function bucket(): Bucket { return { pageViews: 0, visitors: new Set(), sessions: new Set(), newSubscribers: 0, newAccounts: 0, paidConversions: 0, subscriberVisitors: new Set(), visitAt: new Map(), subscriberAt: new Map() }; }
function add(target: Bucket, item: Observation) {
  if (item.kind === "view" || item.kind === "identity") {
    if (item.kind === "view") target.pageViews++;
    if (item.visitor) {
      target.visitors.add(item.visitor);
      if (!target.visitAt.has(item.visitor) || item.at < target.visitAt.get(item.visitor)!) target.visitAt.set(item.visitor, item.at);
    }
    if (item.session) target.sessions.add(item.session);
  } else if (item.kind === "subscriber") {
    target.newSubscribers++;
    if (item.visitor) {
      target.subscriberVisitors.add(item.visitor);
      if (!target.subscriberAt.has(item.visitor) || item.at < target.subscriberAt.get(item.visitor)!) target.subscriberAt.set(item.visitor, item.at);
    }
  } else if (item.kind === "account") target.newAccounts++;
  else target.paidConversions++;
}
function metrics(target: Bucket): AcquisitionMetrics {
  const subscriberVisitors = [...target.subscriberVisitors].filter((visitor) => target.visitors.has(visitor) && target.visitAt.get(visitor)! <= target.subscriberAt.get(visitor)!).length;
  return {
    pageViews: target.pageViews, visitors: target.visitors.size, sessions: target.sessions.size,
    newSubscribers: target.newSubscribers, newAccounts: target.newAccounts, paidConversions: target.paidConversions,
    subscriberVisitors, subscriberRate: target.visitors.size ? subscriberVisitors / target.visitors.size * 100 : null,
  };
}
function contentGroup(raw: unknown, landingPath: string): string {
  if (["stocks", "crypto", "site", "both"].includes(String(raw))) return String(raw);
  if (/^\/crypto(?:\/|$)/.test(landingPath)) return "crypto";
  if (/^\/(?:today|briefings|stocks|model)(?:\/|$)/.test(landingPath)) return "stocks";
  return landingPath === "/unknown" ? "unknown" : "site";
}
function conversion(event: AcquisitionEventRow, touch: "first" | "latest"): Observation | null {
  const metadata = event.metadata ?? {};
  const kind = event.event_name === "email_subscribed" ? "subscriber" : event.event_name === "account_created" ? "account" : "paid";
  if (metadata.event_version !== 2 || metadata.confirmed !== true || metadata.traffic_type !== "human") return null;
  if (kind === "subscriber" && (metadata.conversion_kind !== "new_subscriber" || metadata.confirmation !== "subscriber_record_saved")) return null;
  if (kind === "subscriber" && metadata.stocks_opted_in !== true && metadata.crypto_opted_in !== true) return null;
  if (kind === "account" && (metadata.conversion_kind !== "new_account" || metadata.confirmation !== "verified_auth_user")) return null;
  if (kind === "paid" && (metadata.conversion_kind !== "first_paid_upgrade" || metadata.first_paid_verified !== true || metadata.confirmation !== "stripe_invoice_paid" || !(Number(metadata.amount_minor) > 0))) return null;
  const selected = attributionFor(event, touch, true);
  const ids = identities(event);
  return { kind, at: event.created_at, touch: selected, ...ids, contentGroup: contentGroup(metadata.content_group, selected.landingPath), identified: !!ids.visitor, legacy: false };
}
function latest(values: string[]) { return values.sort().at(-1) ?? null; }

export function buildAcquisitionReport(input: AcquisitionInput, filters: AcquisitionFilters = {}, now = new Date()): AcquisitionReport {
  const range = resolveAcquisitionRange(filters, now);
  if (filters.touch && !["first", "latest"].includes(filters.touch)) throw new Error("Choose first or latest acquisition touch.");
  const selectedTouch = filters.touch ?? "latest";
  const inRange = (at: string) => at >= range.startInclusive && at < range.endExclusive;
  const seenEventIds = new Set<string>();
  const conversionByEntity = new Map<string, AcquisitionEventRow>();
  const identifiedNavigations = new Map<string, AcquisitionEventRow>();
  const observations: Observation[] = [];
  let excludedRows = 0;
  let excludedReferralOnlyRows = 0;
  let subscriberRowsWithoutInitialSnapshot = 0;
  // Consent can arrive after the anonymous initial view. Correlate only that
  // exact navigation in memory, within the session window, after explicit
  // consent. This never updates historical aggregate rows in storage.
  for (const event of input.events) {
    const navigationId = event.metadata?.navigation_id;
    const at = timestamp(event.created_at);
    if (event.event_name !== "visitor_identified" || excluded(event) || !at || !inRange(at)
      || typeof navigationId !== "string" || !UUID.test(navigationId)
      || event.metadata?.event_version !== 2 || event.metadata?.tracking_mode !== "consented"
      || event.metadata?.traffic_type !== "human" || !identities(event).visitor) continue;
    identifiedNavigations.set(navigationId.toLowerCase(), { ...event, created_at: at });
  }
  for (const event of input.events) {
    const at = timestamp(event.created_at);
    if (!at || !inRange(at)) continue;
    if (excluded(event)) { excludedRows++; continue; }
    if (seenEventIds.has(event.id)) continue;
    seenEventIds.add(event.id);
    if (!["page_view", "visitor_identified"].includes(event.event_name)) {
      const entity = event.metadata?.entity_key;
      const prefix = event.event_name === "email_subscribed" ? "subscriber:" : event.event_name === "account_created" ? "account:" : "paid:";
      if (typeof entity !== "string" || !entity.startsWith(prefix) || !/^(?:subscriber|account|paid):[a-f0-9]{64}$/.test(entity) || !conversion(event, selectedTouch)) continue;
      const previous = conversionByEntity.get(entity);
      if (!previous || at < previous.created_at) conversionByEntity.set(entity, { ...event, created_at: at });
      continue;
    }
    const navigationId = event.metadata?.navigation_id;
    const marker = typeof navigationId === "string" ? identifiedNavigations.get(navigationId.toLowerCase()) : null;
    const correlate = event.event_name === "page_view" && event.metadata?.event_version === 2 && event.metadata?.tracking_mode === "aggregate" && marker
      && Date.parse(marker.created_at) >= Date.parse(at) && Date.parse(marker.created_at) - Date.parse(at) <= 30 * 60_000;
    const evidence = correlate ? marker : event;
    const selected = attributionFor(evidence, selectedTouch);
    const ids = identities(evidence);
    if (event.event_name === "visitor_identified" && (!marker || !ids.visitor)) continue;
    observations.push({ kind: event.event_name === "visitor_identified" ? "identity" : "view", at, touch: selected, ...ids, contentGroup: contentGroup(event.metadata?.content_group, path(event.page_path)), identified: !!ids.visitor, legacy: event.metadata?.event_version !== 2 });
  }
  const addEntity = (item: AcquisitionSubscriber | AcquisitionAccount, kind: "subscriber" | "account") => {
    const at = timestamp(item.createdAt);
    if (!at || !inRange(at)) return;
    const event = conversionByEntity.get(item.entityKey);
    const confirmed = event ? conversion(event, selectedTouch) : null;
    // A conversion record may enrich only an actual newly created entity.
    // A repeated/reactivated signup never contributes another new subscriber.
    const valid = confirmed?.kind === kind && confirmed.at === at ? confirmed : null;
    // A private, confirmed signup snapshot proves the original opt-in. Later
    // unsubscribe/interest changes must not erase that acquisition. Without
    // such proof, active zero-opt-in rows can be referral access only and are
    // excluded. Legacy inactive opt-outs remain an explicitly disclosed fallback.
    if (kind === "subscriber" && "status" in item && item.status === "active"
      && item.stocksOptedIn === false && item.cryptoOptedIn === false && !valid) {
      excludedReferralOnlyRows++;
      return;
    }
    if (kind === "subscriber" && !valid) subscriberRowsWithoutInitialSnapshot++;
    observations.push(valid ? { ...valid, at } : { kind, at, touch: unknownTouch(), visitor: null, session: null, contentGroup: "unknown", identified: false, legacy: false });
  };
  const seenSubscribers = new Set<string>();
  for (const item of input.subscribers) {
    if (seenSubscribers.has(item.entityKey)) continue;
    seenSubscribers.add(item.entityKey); addEntity(item, "subscriber");
  }
  const seenAccounts = new Set<string>();
  for (const item of input.accounts) {
    if (seenAccounts.has(item.entityKey)) continue;
    seenAccounts.add(item.entityKey); addEntity(item, "account");
  }
  for (const event of conversionByEntity.values()) {
    if (event.event_name !== "paid_conversion") continue;
    const item = conversion(event, selectedTouch);
    if (item) observations.push(item);
  }
  const options = {
    sources: [...new Set(observations.map((item) => item.touch.source))].sort(),
    campaigns: [...new Set(observations.map((item) => item.touch.campaign))].sort(),
  };
  const filterSource = filters.source && filters.source !== "all" ? source(filters.source) : "";
  const filterCampaign = filters.campaign && filters.campaign !== "all" ? text(filters.campaign) : "";
  const filtered = observations.filter((item) => (!filterSource || item.touch.source === filterSource) && (!filterCampaign || item.touch.campaign === filterCampaign));
  const total = bucket();
  const sources = new Map<string, { row: Omit<AcquisitionBreakdown, keyof AcquisitionMetrics>; bucket: Bucket }>();
  const campaigns = new Map<string, { row: Omit<AcquisitionBreakdown, keyof AcquisitionMetrics>; bucket: Bucket }>();
  const landings = new Map<string, { row: Omit<AcquisitionBreakdown, keyof AcquisitionMetrics>; bucket: Bucket }>();
  const content = new Map<string, { row: Omit<AcquisitionBreakdown, keyof AcquisitionMetrics>; bucket: Bucket }>();
  const daily = new Map<string, Bucket>();
  for (let time = Date.parse(range.startInclusive); time < Date.parse(range.endExclusive); time += DAY_MS) daily.set(new Date(time).toISOString().slice(0, 10), bucket());
  const group = (map: typeof sources, key: string, row: Omit<AcquisitionBreakdown, keyof AcquisitionMetrics>, item: Observation) => {
    let current = map.get(key);
    if (!current) { current = { row, bucket: bucket() }; map.set(key, current); }
    add(current.bucket, item);
  };
  for (const item of filtered) {
    add(total, item);
    const day = daily.get(item.at.slice(0, 10)); if (day) add(day, item);
    const touch = item.touch;
    const sourceKey = JSON.stringify([touch.source, touch.medium]);
    group(sources, sourceKey, { key: sourceKey, label: touch.source, source: touch.source, medium: touch.medium }, item);
    const campaignKey = JSON.stringify([touch.source, touch.medium, touch.campaign]);
    group(campaigns, campaignKey, { key: campaignKey, label: touch.campaign, source: touch.source, medium: touch.medium, campaign: touch.campaign }, item);
    group(landings, touch.landingPath, { key: touch.landingPath, label: touch.landingPath }, item);
    group(content, item.contentGroup, { key: item.contentGroup, label: item.contentGroup }, item);
  }
  const rows = (map: typeof sources) => [...map.values()].map(({ row, bucket: item }) => {
    const value = metrics(item);
    return { ...row, ...value, subscriberRate: row.source === "unknown" ? null : value.subscriberRate };
  }).sort((a, b) => b.newSubscribers - a.newSubscribers || b.paidConversions - a.paidConversions || b.visitors - a.visitors || b.pageViews - a.pageViews || a.label.localeCompare(b.label));
  const overview = metrics(total);
  const views = filtered.filter((item) => item.kind === "view");
  const subscribers = filtered.filter((item) => item.kind === "subscriber");
  const accounts = filtered.filter((item) => item.kind === "account");
  const paid = filtered.filter((item) => item.kind === "paid");
  const hasPriorVisitEvidence = (item: Observation) => !!item.visitor && total.visitors.has(item.visitor) && total.visitAt.get(item.visitor)! <= item.at;
  // Count linked/unlinked conversion entities, not distinct visitors. Several
  // genuine subscriptions/accounts can share one browser visitor identity.
  const linkedSubscriberCount = subscribers.filter(hasPriorVisitEvidence).length;
  const linkedAccountCount = accounts.filter(hasPriorVisitEvidence).length;
  const linkedPaidCount = paid.filter(hasPriorVisitEvidence).length;
  const datasets = input.datasets ?? [
    { name: "events", rows: input.events.length, total: input.events.length, available: true, complete: true },
    { name: "subscribers", rows: input.subscribers.length, total: input.subscribers.length, available: true, complete: true },
    { name: "accounts", rows: input.accounts.length, total: input.accounts.length, available: true, complete: true },
  ];
  const identifiedPageViews = views.filter((item) => item.identified).length;
  const legacyPageViews = views.filter((item) => item.legacy).length;
  const warnings = datasets.filter((item) => !item.complete).map((item) => item.error ?? `${item.name} exceeded the bounded report read; displayed counts are a partial sample.`);
  if (legacyPageViews) warnings.push("Legacy views show only their recorded source. First/latest touch and 30-minute session timing were not recorded then.");
  if (excludedReferralOnlyRows) warnings.push("Active records with neither newsletter opted in and no confirmed initial signup are excluded from new subscribers. A confirmed eligible signup remains counted after later unsubscribe or preference changes.");
  if (subscriberRowsWithoutInitialSnapshot) warnings.push(`${subscriberRowsWithoutInitialSnapshot} subscriber records have no original opt-in snapshot. Historical totals use stored creation dates and current preferences/status; original newsletter eligibility cannot be retrospectively proven and source remains Unknown.`);
  warnings.push("Historical subscriber/account sources remain Unknown when no confirmed attribution was saved. Paid upgrades are verified first payments recorded after this tracking release; older paid conversion history is unavailable.");
  if (overview.pageViews - identifiedPageViews > 0) warnings.push("Aggregate views without consent are counted as views only; distinct visitors, sessions and linked conversion rates cover identified traffic.");
  return {
    range, filters: { preset: filters.preset ?? "30d", source: filterSource, campaign: filterCampaign, touch: selectedTouch },
    overview, sourceRows: rows(sources), campaignRows: rows(campaigns), landingRows: rows(landings), contentRows: rows(content),
    dailySeries: [...daily].map(([date, item]) => ({ date, ...metrics(item) })),
    funnel: [
      { key: "visitors", label: "Identified visitors", value: overview.visitors, denominator: null, rate: null, note: "Distinct IDs with identified views or explicit consent on a public visit in this period." },
      { key: "subscribers", label: "Visitors who subscribed", value: overview.subscriberVisitors, denominator: overview.visitors, rate: overview.subscriberRate, note: "Distinct visitors with identified visit evidence before a confirmed new subscription in this period. Unlinked/Unknown subscriptions are in the overview, not this visitor path." },
      ...(["account", "paid"] as const).map((kind) => {
        const linked = new Set(filtered.filter((item) => item.kind === kind && hasPriorVisitEvidence(item)).map((item) => item.visitor)).size;
        return { key: kind, label: kind === "account" ? "Visitors who made accounts" : "Visitors who upgraded", value: linked, denominator: overview.visitors, rate: overview.visitors ? linked / overview.visitors * 100 : null,
          note: kind === "account" ? "Linked actual Auth registrations. Each milestone uses the observed-visitor denominator; newsletter and account paths can occur independently." : "Linked verified first payments since tracking began. Historical paid upgrades and revenue are unavailable; this is not a sequential funnel." };
      }),
    ],
    coverage: {
      complete: datasets.every((item) => item.complete), datasets, warnings,
      identifiedPageViews, unidentifiedPageViews: overview.pageViews - identifiedPageViews,
      identityCoveragePct: overview.pageViews ? identifiedPageViews / overview.pageViews * 100 : null,
      knownSubscriberSources: subscribers.filter((item) => item.touch.source !== "unknown").length,
      unknownSubscriberSources: subscribers.filter((item) => item.touch.source === "unknown").length,
      knownAccountSources: accounts.filter((item) => item.touch.source !== "unknown").length,
      unknownAccountSources: accounts.filter((item) => item.touch.source === "unknown").length,
      linkedSubscriberCount, linkedAccountCount, linkedPaidCount,
      unlinkedSubscriberCount: subscribers.length - linkedSubscriberCount,
      unlinkedAccountCount: accounts.length - linkedAccountCount,
      unlinkedPaidCount: paid.length - linkedPaidCount,
      legacyPageViews, excludedRows, excludedReferralOnlyRows, paidHistoryAvailable: false,
      consentIdentifiedVisits: filtered.filter((item) => item.kind === "identity").length,
      truncatedDatasets: datasets.filter((item) => item.available && !item.complete && !item.error).map((item) => item.name),
    },
    freshness: { loadedAt: now.toISOString(), latestPageViewAt: latest(views.map((item) => item.at)), latestConversionAt: latest(filtered.filter((item) => ["subscriber", "account", "paid"].includes(item.kind)).map((item) => item.at)) },
    options,
    definitions: [
      "All ranges use inclusive UTC calendar dates. Today's totals are still accumulating.",
      "Views are observed page-view events, not distinct people. Visitors/sessions need an actual identified view or explicit consent marker; conversion records alone never invent visitors. An initial anonymous view can be linked in memory only to consent on the exact navigation within 30 minutes.",
      "Visitors are distinct within each group. A visitor can use several sources/content groups, so grouped visitor/session counts are not additive.",
      "First touch is the earliest discovery saved within the 90-day attribution window. Latest touch is the last saved non-direct acquisition; direct returns and internal auth/checkout links do not overwrite it.",
      "Unidentified aggregate views show only the current visit source in either touch view; they have no persistent first/latest history or conversion linkage.",
      "The newsletter rate is converted identified visitors divided by visitors with identified visit evidence in the same period and filters. Visit evidence must precede the conversion. It is an observed-period rate, not a lifetime acquisition cohort.",
      "Linked/unlinked outcome counts count distinct conversion entities. Funnel values count distinct linked visitors, so several real signups from one visitor remain several outcomes. Unlinked means no earlier matching visit in the selected period/filters; a saved source can still be known.",
      "New subscribers come from unique stored creation dates. A confirmed eligible signup snapshot retains its original attribution after unsubscribe or interest changes; current eligibility does not rewrite acquisition. Without an original snapshot, legacy totals use current preferences/status and cannot prove original eligibility. Active zero-opt-in rows without a confirmed signup, resubscriptions and repeated form successes are excluded.",
      "New accounts are email-confirmed Auth accounts whose actual creation date falls in the period; confirmation is checked at report time. Unconfirmed registration attempts are excluded.",
      "Source filters apply to the chosen attribution touch, including Unknown; dates apply to the view/conversion occurrence, not the original discovery date.",
      "Share button clicks, client signup success signals, provider delivery claims and bot/test traffic are excluded from acquisition conversion totals.",
    ],
  };
}

type ReadResult<T> = { rows: T[]; coverage: AcquisitionDatasetCoverage };
function remainingReadTime(deadline: number) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("read_budget_exhausted");
  return Math.min(QUERY_TIMEOUT_MS, remaining);
}
function boundedRead<T>(read: Promise<T>, timeoutMs: number): Promise<T> {
  // Auth admin listUsers has no per-call AbortSignal option. Bound waiting for
  // this read-only operation; there is no account mutation to abandon/replay.
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("read_timeout")), timeoutMs);
    read.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
async function readEvents(admin: SupabaseClient, range: AcquisitionRange): Promise<ReadResult<AcquisitionEventRow>> {
  const rows: AcquisitionEventRow[] = [];
  const deadline = Date.now() + DATASET_TIMEOUT_MS;
  let cursor: string | null = null;
  let total: number | null = null;
  try {
    while (rows.length < MAX_EVENT_ROWS) {
      let query = admin.from("marketing_event_log")
        .select("id,event_name,created_at,anonymous_id,session_id,page_path,referrer,utm_source,utm_medium,utm_campaign,metadata", { count: cursor ? undefined : "exact" })
        .in("event_name", [...ACQUISITION_EVENT_NAMES])
        .gte("created_at", range.startInclusive).lt("created_at", range.endExclusive)
        .order("id", { ascending: true }).limit(PAGE_SIZE);
      if (cursor) query = query.gt("id", cursor);
      const result = await query.abortSignal(AbortSignal.timeout(remainingReadTime(deadline)));
      if (result.error) throw new Error("query_failed");
      if (total === null && result.count !== null) total = result.count;
      const page = (result.data ?? []) as AcquisitionEventRow[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) return { rows, coverage: { name: "events", rows: rows.length, total: total ?? rows.length, available: true, complete: true } };
      cursor = page[page.length - 1].id;
    }
    return { rows, coverage: { name: "events", rows: rows.length, total, available: true, complete: total !== null && rows.length >= total } };
  } catch {
    return { rows, coverage: { name: "events", rows: rows.length, total, available: rows.length > 0, complete: false, error: "Acquisition event history could not be fully loaded; any displayed counts are partial." } };
  }
}
function entityKey(kind: "subscriber" | "account", value: string) { return `${kind}:${createHash("sha256").update(value.trim().toLowerCase()).digest("hex")}`; }
function testEmail(value: string | null | undefined) { return !value || /(?:@example\.(?:invalid|com)$|@test\.(?:com|invalid)$|^(?:codex[-+_]|qa[-+_]|test[-+_]))/i.test(value); }
async function readSubscribers(admin: SupabaseClient, range: AcquisitionRange): Promise<ReadResult<AcquisitionSubscriber>> {
  const rows: AcquisitionSubscriber[] = [];
  const deadline = Date.now() + DATASET_TIMEOUT_MS;
  let scanned = 0;
  let cursor: string | null = null;
  let total: number | null = null;
  try {
    while (scanned < MAX_ENTITY_ROWS) {
      let query = admin.from("free_subscribers").select("email,created_at,status,stocks_opted_in,crypto_opted_in", { count: cursor ? undefined : "exact" })
        .gte("created_at", range.startInclusive).lt("created_at", range.endExclusive)
        .order("email", { ascending: true }).limit(PAGE_SIZE);
      if (cursor) query = query.gt("email", cursor);
      const result = await query.abortSignal(AbortSignal.timeout(remainingReadTime(deadline)));
      if (result.error) throw new Error("query_failed");
      if (total === null && result.count !== null) total = result.count;
      const page = (result.data ?? []) as { email: string; created_at: string; status: string; stocks_opted_in: boolean; crypto_opted_in: boolean }[];
      scanned += page.length;
      for (const item of page) if (!testEmail(item.email)) rows.push({ entityKey: entityKey("subscriber", item.email), createdAt: item.created_at, status: item.status, stocksOptedIn: item.stocks_opted_in, cryptoOptedIn: item.crypto_opted_in });
      if (page.length < PAGE_SIZE) return { rows, coverage: { name: "subscribers", rows: scanned, total: total ?? scanned, available: true, complete: true } };
      cursor = page[page.length - 1].email;
    }
    return { rows, coverage: { name: "subscribers", rows: scanned, total, available: true, complete: total !== null && scanned >= total } };
  } catch {
    return { rows, coverage: { name: "subscribers", rows: scanned, total, available: rows.length > 0, complete: false, error: "Subscriber creation history could not be fully loaded; any displayed counts are partial." } };
  }
}
async function readAccounts(admin: SupabaseClient, range: AcquisitionRange): Promise<ReadResult<AcquisitionAccount>> {
  const rows: AcquisitionAccount[] = [];
  const deadline = Date.now() + DATASET_TIMEOUT_MS;
  let scanned = 0;
  let page = 1;
  try {
    // The public billing row's created_at is not an account creation timestamp.
    // Supabase Auth is the authoritative source, including OAuth signups.
    while (scanned < MAX_ENTITY_ROWS) {
      const timeoutMs = remainingReadTime(deadline);
      const result = await boundedRead(admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE }), timeoutMs);
      if (result.error) throw new Error("auth_query_failed");
      const users = result.data.users;
      scanned += users.length;
      for (const user of users) {
        if (!testEmail(user.email) && Boolean(user.email_confirmed_at || user.confirmed_at)
          && user.created_at >= range.startInclusive && user.created_at < range.endExclusive) rows.push({ entityKey: entityKey("account", user.id), createdAt: user.created_at });
      }
      if (users.length < PAGE_SIZE) return { rows, coverage: { name: "accounts", rows: scanned, total: scanned, available: true, complete: true } };
      page++;
    }
    return { rows, coverage: { name: "accounts", rows: scanned, total: null, available: true, complete: false } };
  } catch {
    return { rows, coverage: { name: "accounts", rows: scanned, total: null, available: rows.length > 0, complete: false, error: "Actual account creation history could not be fully loaded; any displayed counts are partial." } };
  }
}

export async function getAcquisitionReport(filters: AcquisitionFilters = {}, admin: SupabaseClient = createSupabaseAdminClient({ timeoutMs: QUERY_TIMEOUT_MS }), now = new Date()): Promise<AcquisitionReport> {
  const range = resolveAcquisitionRange(filters, now);
  const [events, subscribers, accounts] = await Promise.all([readEvents(admin, range), readSubscribers(admin, range), readAccounts(admin, range)]);
  return buildAcquisitionReport({ events: events.rows, subscribers: subscribers.rows, accounts: accounts.rows, datasets: [events.coverage, subscribers.coverage, accounts.coverage] }, filters, now);
}

export function acquisitionCsv(report: AcquisitionReport, view: "sources" | "campaigns" | "landings" | "content" = "sources"): string {
  const rows = view === "campaigns" ? report.campaignRows : view === "landings" ? report.landingRows : view === "content" ? report.contentRows : report.sourceRows;
  const escape = (value: string | number | null | undefined) => {
    let result = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(result)) result = `'${result}`;
    return `"${result.replace(/"/g, '""')}"`;
  };
  const available = (name: AcquisitionDatasetCoverage["name"]) => report.coverage.datasets.find((item) => item.name === name)?.available !== false;
  const events = available("events"), subscribers = available("subscribers"), accounts = available("accounts");
  const header = ["start_utc", "end_utc", "attribution_touch", "complete", "events_available", "subscribers_available", "accounts_available", "group", "source", "medium", "campaign", "page_views", "identified_visitors", "identified_sessions", "new_subscribers", "new_accounts", "confirmed_paid_upgrades", "linked_subscriber_visitors", "identified_visitor_signup_rate_pct"];
  return [header.map(escape).join(","), ...rows.map((row) => [report.range.startDate, report.range.endDate, report.filters.touch, String(report.coverage.complete), String(events), String(subscribers), String(accounts), row.label, row.source, row.medium, row.campaign,
    events ? row.pageViews : null, events ? row.visitors : null, events ? row.sessions : null,
    subscribers ? row.newSubscribers : null, accounts ? row.newAccounts : null, events ? row.paidConversions : null,
    events && subscribers ? row.subscriberVisitors : null, events && subscribers ? row.subscriberRate : null,
  ].map(escape).join(","))].join("\r\n");
}
