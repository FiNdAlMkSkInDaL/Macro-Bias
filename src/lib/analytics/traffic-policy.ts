/** Shared, deterministic exclusions. Missing historic signals are not evidence of a bot. */
export const ANALYTICS_INTERNAL_EMAILS = ["finphillips21@gmail.com", "finlayp32@gmail.com"] as const;
const INTERNAL_EMAILS = new Set<string>(ANALYTICS_INTERNAL_EMAILS);

export type AnalyticsTrafficEvent = {
  anonymous_id?: string | null;
  session_id?: string | null;
  subscriber_email?: string | null;
  page_path?: string | null;
  referrer?: string | null;
  utm_source?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ExcludedAnalyticsIdentities = {
  anonymousIds: Set<string>;
  sessionIds: Set<string>;
  emails: Set<string>;
  entityKeys: Set<string>;
};

export function normalizeAnalyticsEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function isExcludedAnalyticsEmail(value: string | null | undefined) {
  const email = normalizeAnalyticsEmail(value);
  const [local, domain = ""] = email.split("@");
  if (!email) return false;
  // The existing analytics/test-lab administrator also uses Gmail plus aliases.
  if (INTERNAL_EMAILS.has(`${local?.split("+")[0]}@${domain}`)) return true;
  return /(^|\.)(example\.(com|net|org|edu)|test\.com|test|invalid|localhost|example)$/.test(domain);
}

export function isNonProductionAnalyticsHost(value: string | null | undefined) {
  if (!value) return false;
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname === "::1" || /^127\./.test(hostname) || hostname === "0.0.0.0" ||
    (hostname.startsWith("macro-bias-") && hostname.endsWith("-findalmkskindals-projects.vercel.app")) ||
    hostname.endsWith(".test") || hostname.endsWith(".invalid");
}

export function isAutomatedAnalyticsUserAgent(value: string | null | undefined) {
  if (!value) return false;
  return /bot\b|crawler|spider|headless|playwright|puppeteer|selenium|phantomjs|lighthouse|pagespeed|python-requests|python-httpx|curl\/|wget\/|node-fetch|undici|facebookexternalhit|twitterbot|slackbot|discordbot|googleimageproxy|prefetch/i.test(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function eventIdentities(event: AnalyticsTrafficEvent) {
  const metadata = event.metadata ?? {};
  // Aggregate observations never establish a persistent identity, even if an older body supplied one.
  if (metadata.event_version === 2 && metadata.tracking_mode !== "consented") return { anonymousId: null, sessionId: null };
  const attribution = metadata.tracking_mode === "consented" ? objectValue(metadata.attribution) : {};
  return {
    anonymousId: event.anonymous_id ?? textValue(attribution.visitorId) ?? null,
    sessionId: event.session_id ?? textValue(attribution.sessionId) ?? null,
  };
}

function nonProductionUrl(value: string | null | undefined) {
  if (!value) return false;
  try { return isNonProductionAnalyticsHost(new URL(value).hostname); } catch { return false; }
}

function directExclusionReason(event: AnalyticsTrafficEvent): string | null {
  const metadata = event.metadata ?? {};
  const traffic = objectValue(metadata.analytics_traffic);
  if (/^(?:test|qa|codex-test)(?:[-_:]|$)/i.test(event.utm_source ?? "")) return "test_campaign";
  if (["bot", "test", "internal", "synthetic"].includes(String(metadata.traffic_type ?? "").toLowerCase())) return "explicit_test_or_automation";
  if (isExcludedAnalyticsEmail(event.subscriber_email) ||
    isExcludedAnalyticsEmail(textValue(traffic.authenticated_email))) return "internal_or_test_identity";
  if (/^\/(analytics|test|test-lab)(\/|\?|$)/.test(event.page_path ?? "")) return "internal_page";
  if (nonProductionUrl(event.referrer) || nonProductionUrl(event.page_path) ||
    isNonProductionAnalyticsHost(textValue(traffic.hostname))) return "non_production_host";
  if (traffic.environment === "development" || traffic.environment === "preview" || traffic.environment === "test") return "non_production_environment";
  if (traffic.webdriver === true || traffic.excluded === true || traffic.traffic_type === "internal" ||
    metadata.is_test === true || metadata.isTest === true || metadata.test === true ||
    metadata.is_bot === true || metadata.automated === true || metadata.internal === true) return "explicit_test_or_automation";
  if (isAutomatedAnalyticsUserAgent(textValue(traffic.user_agent)) ||
    isAutomatedAnalyticsUserAgent(textValue(metadata.user_agent)) || isAutomatedAnalyticsUserAgent(textValue(metadata.userAgent))) return "automated_user_agent";
  return null;
}

export function getAnalyticsEventExclusionReason(event: AnalyticsTrafficEvent, identities?: ExcludedAnalyticsIdentities): string | null {
  const reason = directExclusionReason(event);
  if (reason) return reason;
  const linkedIds = eventIdentities(event);
  if (identities && ((linkedIds.anonymousId && identities.anonymousIds.has(linkedIds.anonymousId)) ||
    (linkedIds.sessionId && identities.sessionIds.has(linkedIds.sessionId)) ||
    (event.subscriber_email && identities.emails.has(normalizeAnalyticsEmail(event.subscriber_email))) ||
    (typeof event.metadata?.entity_key === "string" && identities.entityKeys.has(event.metadata.entity_key)))) return "linked_internal_or_test_identity";
  return null;
}

/** Propagate proven exclusions through connected browser, session and email identities. */
export function buildExcludedAnalyticsIdentities(events: readonly AnalyticsTrafficEvent[]): ExcludedAnalyticsIdentities {
  const identities: ExcludedAnalyticsIdentities = { anonymousIds: new Set(), sessionIds: new Set(), emails: new Set(), entityKeys: new Set() };
  const linkedEvents = new Map<string, number[]>();
  const keysFor = (event: AnalyticsTrafficEvent) => {
    const linkedIds = eventIdentities(event);
    return [
    linkedIds.anonymousId ? `a:${linkedIds.anonymousId}` : "",
    linkedIds.sessionId ? `s:${linkedIds.sessionId}` : "",
    event.subscriber_email ? `e:${normalizeAnalyticsEmail(event.subscriber_email)}` : "",
    typeof event.metadata?.entity_key === "string" ? `k:${event.metadata.entity_key}` : "",
  ].filter(Boolean);
  };
  const queue: number[] = [];
  events.forEach((event, index) => {
    for (const key of keysFor(event)) {
      const linked = linkedEvents.get(key) ?? [];
      linked.push(index);
      linkedEvents.set(key, linked);
    }
    if (directExclusionReason(event)) queue.push(index);
  });
  const seenEvents = new Set<number>();
  const seenKeys = new Set<string>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    if (seenEvents.has(index)) continue;
    seenEvents.add(index);
    const event = events[index];
    const linkedIds = eventIdentities(event);
    if (linkedIds.anonymousId) identities.anonymousIds.add(linkedIds.anonymousId);
    if (linkedIds.sessionId) identities.sessionIds.add(linkedIds.sessionId);
    if (event.subscriber_email) identities.emails.add(normalizeAnalyticsEmail(event.subscriber_email));
    if (typeof event.metadata?.entity_key === "string") identities.entityKeys.add(event.metadata.entity_key);
    for (const key of keysFor(event)) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      queue.push(...(linkedEvents.get(key) ?? []));
    }
  }
  return identities;
}

export function filterAnalyticsEvents<T extends AnalyticsTrafficEvent>(events: readonly T[], identities = buildExcludedAnalyticsIdentities(events)): T[] {
  return events.filter((event) => !getAnalyticsEventExclusionReason(event, identities));
}

/** This collector marker is added only after the API's traffic and origin checks. */
export function hasEligibleAnalyticsCapture(event: AnalyticsTrafficEvent) {
  const metadata = event.metadata ?? {};
  const context = objectValue(metadata.capture_context);
  return !directExclusionReason(event) && metadata.event_version === 2 && metadata.traffic_type === "human" &&
    context.version === 1 && context.environment === "production" && context.collector === "public_api" && context.automation_checked === true;
}

/** Independent stable UUID so an exclusion can coexist with the already recorded visit. */
export function analyticsExclusionEventId(eventId: string) {
  const prefix = ((parseInt(eventId.slice(0, 8), 16) ^ 0x6d626578) >>> 0).toString(16).padStart(8, "0");
  return `${prefix}${eventId.slice(8)}`;
}

