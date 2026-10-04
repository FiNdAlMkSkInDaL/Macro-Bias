/** Shared, deliberately small attribution format. Never store complete URLs or query strings. */
export const ACQUISITION_COOKIE = 'mb_acquisition_v2';
export const ANALYTICS_CONSENT_COOKIE = 'mb_analytics_consent';
export const ATTRIBUTION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AcquisitionTouch = {
  source: string;
  medium: string;
  campaign: string | null;
  content: string | null;
  referrerDomain: string | null;
  landingPath: string;
  capturedAt: string;
};

export type AcquisitionAttribution = {
  version: 2;
  visitorId: string;
  sessionId: string;
  firstTouch: AcquisitionTouch;
  latestTouch: AcquisitionTouch;
  expiresAt: string;
};

export type PrivacySignals = { dnt?: string | null; gpc?: string | null };

/** Separate stable PK for a consent marker attached to an existing navigation. */
export function identifiedVisitId(navigationId: string): string {
  const prefix = ((parseInt(navigationId.slice(0, 8), 16) ^ 0x6d626964) >>> 0).toString(16).padStart(8, '0');
  return `${prefix}${navigationId.slice(8)}`;
}

const SECRET_PARAMETER = /^(?:code|token|access_token|refresh_token|id_token|token_hash|password|email|redirectto|redirect_to|session_id|checkout_session_id)$/i;
const EXCLUDED_PATH = /^\/(?:analytics|account|alerts|dashboard|test|admin|api|auth|login|signup|sign-up|sign-in|forgot-password|reset-password|update-password|checkout|billing)(?:\/|$)/i;
const SEARCH_DOMAINS = /(^|\.)(google\.(?:com|cat|[a-z]{2}|(?:co|com)\.[a-z]{2})|bing\.com|duckduckgo\.com|search\.yahoo\.(?:com|co\.jp|co\.uk)|ecosia\.org|brave\.com)$/;
const ANDROID_REFERRER_PACKAGES = new Set(['com.reddit.frontpage', 'com.google.android.gm']);
const SOCIAL_DOMAINS = /(^|\.)(x\.com|t\.co|twitter\.com|facebook\.com|instagram\.com|linkedin\.com|reddit\.com|threads\.net|bsky\.app|youtube\.com|tiktok\.com)$/;
const SERVICE_DOMAINS = /(^|\.)(stripe\.com|supabase\.co|accounts\.google\.com|login\.microsoftonline\.com)$/;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Reject private values rather than retaining an email, recovery token, or arbitrary URL. */
export function normalizeDimension(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 256 || /@|https?:|[\r\n]|eyJ[a-zA-Z0-9_-]{20}/.test(value)) return null;
  const result = value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_.:-]/g, '').slice(0, 80);
  return result || null;
}

export function normalizeSource(value: unknown): string | null {
  const source = normalizeDimension(value);
  if (!source) return null;
  if (/^(?:twitter|twitter\.com|x\.com|t\.co)$/.test(source)) return 'x';
  if (source === 'com.google.android.gm') return 'gmail';
  if (/(^|\.)(google\.(?:com|cat|[a-z]{2}|(?:co|com)\.[a-z]{2}))$/.test(source)) return 'google';
  if (source === 'com.reddit.frontpage') return 'reddit';
  if (/(^|\.)(yahoo\.(?:com|co\.jp|co\.uk))$/.test(source)) return 'yahoo';
  for (const platform of ['bing', 'duckduckgo', 'reddit', 'linkedin', 'facebook', 'instagram', 'youtube', 'tiktok']) {
    if (source === `${platform}.com` || source.endsWith(`.${platform}.com`)) return platform;
  }
  if (source === 'bsky.app') return 'bluesky';
  return source;
}

export function normalizePagePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 2048) return null;
  try {
    const path = new URL(value, 'https://macro-bias.com').pathname;
    if (/%40|@|[\\\r\n]|%0[ad]/i.test(path)) return null;
    return path.slice(0, 256);
  } catch { return null; }
}

export function isExcludedAnalyticsPath(value: unknown): boolean {
  const path = normalizePagePath(value);
  return !path || EXCLUDED_PATH.test(path);
}

export function contentGroup(pagePath: string): 'stocks' | 'crypto' | 'site' {
  if (/^\/crypto(?:\/|$)/.test(pagePath)) return 'crypto';
  return /^\/(?:today|stocks|briefings|research)(?:\/|$)/.test(pagePath) ? 'stocks' : 'site';
}

export function normalizeReferrerDomain(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (url.username || url.password) return null;
    const domain = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol === 'android-app:') return !url.port && ANDROID_REFERRER_PACKAGES.has(url.hostname.toLowerCase()) ? url.hostname.toLowerCase() : null;
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return /^[a-z0-9.-]{1,253}$/.test(domain) ? domain : null;
  } catch { return null; }
}

export function isSelfOrServiceReferrer(domain: string, hostname: string): boolean {
  return domain === hostname.toLowerCase().replace(/^www\./, '')
    || domain === 'macro-bias.com' || domain === 'localhost' || domain === '127.0.0.1'
    || /^macro-bias(?:-[a-z0-9-]+)?\.vercel\.app$/.test(domain) || SERVICE_DOMAINS.test(domain);
}

export function privacyOptOut(signals: PrivacySignals): boolean {
  return signals.dnt === '1' || signals.gpc === '1';
}

export function isKnownTestTraffic(hostname: string, userAgent: string): boolean {
  return /(^|\.)(localhost|127\.0\.0\.1|vercel\.app)$/.test(hostname.split(':')[0].toLowerCase())
    || /bot\b|crawler|spider|headless|playwright|puppeteer|lighthouse|pagespeed|pingdom|uptimerobot|curl\b|wget\b|python-requests|node-fetch|^node$/i.test(userAgent);
}

/** A direct visit is an observed source, never a retroactive explanation for older data. */
export function deriveAcquisitionTouch(input: { url: string; referrer?: string | null; now?: number }): AcquisitionTouch | null {
  try {
    const url = new URL(input.url);
    const path = normalizePagePath(url.pathname);
    if (!path || isExcludedAnalyticsPath(path) || [...url.searchParams.keys()].some(key => SECRET_PARAMETER.test(key))) return null;
    const rawDomain = normalizeReferrerDomain(input.referrer);
    const domain = rawDomain && !isSelfOrServiceReferrer(rawDomain, url.hostname) ? rawDomain : null;
    const source = normalizeSource(url.searchParams.get('utm_source'));
    const medium = normalizeDimension(url.searchParams.get('utm_medium'));
    const campaign = normalizeDimension(url.searchParams.get('utm_campaign'));
    const content = normalizeDimension(url.searchParams.get('utm_content'));
    const referral = /^[a-z0-9_-]{3,64}$/i.test(url.searchParams.get('ref') ?? '');
    const hasCampaign = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].some(key => url.searchParams.has(key));
    return {
      source: source ?? (referral ? 'referral' : normalizeSource(domain) ?? (hasCampaign ? 'unknown' : 'direct')),
      medium: medium ?? (referral ? 'referral' : domain ? (domain === 'com.google.android.gm' ? 'email' : SEARCH_DOMAINS.test(domain) ? 'organic' : SOCIAL_DOMAINS.test(domain) || domain === 'com.reddit.frontpage' ? 'social' : 'referral') : hasCampaign ? 'unknown' : 'none'),
      campaign, content, referrerDomain: domain, landingPath: path,
      capturedAt: new Date(input.now ?? Date.now()).toISOString(),
    };
  } catch { return null; }
}

export function normalizeTouch(value: unknown, now = Date.now()): AcquisitionTouch | null {
  const record = object(value);
  if (!record) return null;
  const source = normalizeSource(record.source);
  const medium = normalizeDimension(record.medium);
  const landingPath = normalizePagePath(record.landingPath);
  const timestamp = typeof record.capturedAt === 'string' ? Date.parse(record.capturedAt) : NaN;
  if (!source || !medium || !landingPath || isExcludedAnalyticsPath(landingPath)
    || !Number.isFinite(timestamp) || timestamp > now + 5 * 60_000 || timestamp < now - ATTRIBUTION_MAX_AGE_MS) return null;
  const referrerDomain = normalizeReferrerDomain(record.referrerDomain);
  return { source, medium, campaign: normalizeDimension(record.campaign), content: normalizeDimension(record.content),
    referrerDomain: referrerDomain && !isSelfOrServiceReferrer(referrerDomain, 'macro-bias.com') ? referrerDomain : null,
    landingPath, capturedAt: new Date(timestamp).toISOString() };
}

export function normalizeAttribution(value: unknown, now = Date.now()): AcquisitionAttribution | null {
  const record = object(value);
  if (!record || record.version !== 2 || typeof record.visitorId !== 'string' || !UUID_PATTERN.test(record.visitorId)
    || typeof record.sessionId !== 'string' || !UUID_PATTERN.test(record.sessionId)) return null;
  const firstTouch = normalizeTouch(record.firstTouch, now);
  const latestTouch = normalizeTouch(record.latestTouch, now);
  const expiry = typeof record.expiresAt === 'string' ? Date.parse(record.expiresAt) : NaN;
  if (!firstTouch || !latestTouch || !Number.isFinite(expiry) || expiry <= now
    || expiry > Date.parse(firstTouch.capturedAt) + ATTRIBUTION_MAX_AGE_MS
    || Date.parse(latestTouch.capturedAt) < Date.parse(firstTouch.capturedAt)) return null;
  return { version: 2, visitorId: record.visitorId.toLowerCase(), sessionId: record.sessionId.toLowerCase(), firstTouch, latestTouch, expiresAt: new Date(expiry).toISOString() };
}

export function cookieValue(header: string | null, name: string): string | null {
  if (!header || header.length > 16384) return null;
  const item = header.split(';').find(item => item.trim().startsWith(`${name}=`));
  if (!item) return null;
  try { return decodeURIComponent(item.trim().slice(name.length + 1)); } catch { return null; }
}

export function parseAcquisitionCookie(header: string | null, signals: PrivacySignals = {}, now = Date.now()): AcquisitionAttribution | null {
  if (privacyOptOut(signals) || cookieValue(header, ANALYTICS_CONSENT_COOKIE) !== 'granted') return null;
  const value = cookieValue(header, ACQUISITION_COOKIE);
  if (!value || value.length > 3000) return null;
  try { return normalizeAttribution(JSON.parse(value), now); } catch { return null; }
}

export function attributionMetadata(attribution: AcquisitionAttribution | null, pagePath: string): Record<string, unknown> {
  return { event_version: 2, traffic_type: 'human', tracking_mode: attribution ? 'consented' : 'unlinked',
    attribution, content_group: contentGroup(normalizePagePath(pagePath) ?? '/') };
}
