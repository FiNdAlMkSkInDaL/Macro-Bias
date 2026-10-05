import {
  UUID_PATTERN, contentGroup, isExcludedAnalyticsPath, normalizeDimension, normalizePagePath,
  normalizeTouch, parseAcquisitionCookie, identifiedVisitId, type PrivacySignals,
} from './attribution';

/** Confirmed subscriptions, accounts, billing and delivery claims are server-only. */
export const PUBLIC_ANALYTICS_EVENTS = new Set([
  'page_view', 'nav_logo_click', 'nav_link_click', 'nav_cta_click',
  'footer_logo_click', 'footer_link_click', 'referral_cta_click',
  'referral_link_clicked', 'referral_page_viewed', 'referral_share_clicked',
  'referral_status_loaded', 'email_signup_failure', 'visitor_identified',
]);

type PublicCaptureContext = PrivacySignals & { cookieHeader: string | null; now?: number };

export type PublicMarketingEvent = {
  id: string; eventName: string; pagePath: string; anonymousId: string | null; sessionId: string | null;
  referrer: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null;
  metadata: Record<string, unknown>;
};

function safeLabel(value: unknown): string | null {
  if (typeof value !== 'string' || /@|[\r\n]|eyJ[a-zA-Z0-9_-]{20}|(?:access_token|refresh_token|token_hash|password)=/i.test(value)) return null;
  return value.trim().replace(/\s+/g, ' ').slice(0, 120) || null;
}

function safeLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value, 'https://macro-bias.com');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const path = normalizePagePath(url.pathname);
    if (!path || isExcludedAnalyticsPath(path)) return null;
    return url.hostname.replace(/^www\./, '') === 'macro-bias.com' ? path : `${url.hostname}${path}`.slice(0, 256);
  } catch { return null; }
}

/** No arbitrary JSON, email address, error text, full referrer or tokenized link survives. */
export function sanitizePublicMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ['label', 'title']) {
    const text = safeLabel(input[key]);
    if (text) result[key] = text;
  }
  for (const key of ['location', 'method', 'funnel']) {
    const text = normalizeDimension(input[key]);
    if (text) result[key] = text;
  }
  for (const key of ['stocks', 'crypto']) {
    if (input[key] === true || input[key] === 'true') result[key] = true;
    else if (input[key] === false || input[key] === 'false') result[key] = false;
  }
  const href = safeLink(input.href);
  if (href) result.href = href;
  if (typeof input.navigation_id === 'string' && UUID_PATTERN.test(input.navigation_id)) result.navigation_id = input.navigation_id.toLowerCase();
  return result;
}

export function normalizePublicCapture(value: unknown, context: PublicCaptureContext):
  { event: PublicMarketingEvent | null; error?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { event: null, error: 'Invalid event.' };
  const input = value as Record<string, unknown>;
  if (typeof input.eventName !== 'string' || !PUBLIC_ANALYTICS_EVENTS.has(input.eventName)) return { event: null, error: 'This event must be recorded by the server.' };
  if (typeof input.eventId !== 'string' || !UUID_PATTERN.test(input.eventId)) return { event: null, error: 'Invalid event identity.' };
  const pagePath = normalizePagePath(input.pagePath);
  if (!pagePath) return { event: null, error: 'Invalid page path.' };
  if (isExcludedAnalyticsPath(pagePath)) return { event: null };
  const attribution = parseAcquisitionCookie(context.cookieHeader, context, context.now);
  if (!attribution && input.eventName !== 'page_view') return { event: null };
  const inputMetadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata as Record<string, unknown> : {};
  if (input.eventName === 'visitor_identified' && (typeof inputMetadata.navigation_id !== 'string'
    || !UUID_PATTERN.test(inputMetadata.navigation_id) || identifiedVisitId(inputMetadata.navigation_id.toLowerCase()) !== input.eventId.toLowerCase())) {
    return { event: null, error: 'Invalid visit identity.' };
  }
  const aggregateTouch = !attribution ? normalizeTouch(inputMetadata.aggregate_touch, context.now) : null;
  const touch = attribution?.latestTouch ?? aggregateTouch;
  const metadata = attribution ? sanitizePublicMetadata(inputMetadata) : {};
  if (!attribution && typeof inputMetadata.navigation_id === 'string' && UUID_PATTERN.test(inputMetadata.navigation_id)) metadata.navigation_id = inputMetadata.navigation_id.toLowerCase();
  return { event: {
    id: input.eventId.toLowerCase(), eventName: input.eventName, pagePath,
    anonymousId: attribution?.visitorId ?? null, sessionId: attribution?.sessionId ?? null,
    referrer: touch?.referrerDomain ?? null,
    utmSource: touch?.source ?? null, utmMedium: touch?.medium ?? null, utmCampaign: touch?.campaign ?? null,
    metadata: { ...metadata, event_version: 2, traffic_type: 'human',
      tracking_mode: attribution ? 'consented' : 'aggregate', content_group: contentGroup(pagePath),
      ...(attribution ? { attribution } : { aggregate_touch: aggregateTouch }),
    },
  } };
}
