"use client";

import {
  ACQUISITION_COOKIE, ANALYTICS_CONSENT_COOKIE, ATTRIBUTION_MAX_AGE_MS, SESSION_IDLE_MS,
  UUID_PATTERN, cookieValue, deriveAcquisitionTouch, isExcludedAnalyticsPath, isKnownTestTraffic,
  normalizeAttribution, normalizePagePath, normalizeTouch, privacyOptOut, contentGroup, identifiedVisitId, parseAcquisitionCookie,
  type AcquisitionAttribution, type AcquisitionTouch,
} from './attribution';
import { PUBLIC_ANALYTICS_EVENTS, sanitizePublicMetadata } from './public-capture';

const ANALYTICS_ENDPOINT = '/api/analytics/track';
const STORAGE_KEY = 'macro-bias.acquisition.v2';
const ANONYMOUS_ID_KEY = 'macro-bias.anonymous-id';
const SESSION_ID_KEY = 'macro-bias.session-id';
export const CONSENT_CHANGE_EVENT = 'macro-bias:analytics-consent';

export type ClientAnalyticsEvent = {
  eventName: string;
  metadata?: Record<string, unknown>;
  pagePath?: string;
  referrer?: string | null;
  /** Retained for source compatibility; emails are never sent by browser analytics. */
  subscriberEmail?: string | null;
};

type StoredAcquisition = { attribution: AcquisitionAttribution; lastActivityAt: number };
let memoryRecord: StoredAcquisition | null = null;
let memoryConsent: 'granted' | 'denied' | null = null;
let initialLocation: string | null = null;
let lastCapturedLocation: string | null = null;
let navigationLocation: string | null = null;
let navigationId: string | null = null;
// Sanitized labels only, held in this page's memory until the visitor makes a choice.
let pendingFirstTouch: AcquisitionTouch | null = null;
let pendingLatestTouch: AcquisitionTouch | null = null;

export function createAnalyticsId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let index = 0; index < 16; index++) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function browserPrivacyOptOut() {
  if (typeof navigator === 'undefined') return true;
  return privacyOptOut({ dnt: navigator.doNotTrack, gpc: (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl ? '1' : null });
}

function writeCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${window.location.protocol === 'https:' ? '; Secure' : ''}`;
}

function clearAcquisition() {
  memoryRecord = null;
  lastCapturedLocation = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(ANONYMOUS_ID_KEY);
    window.sessionStorage.removeItem(SESSION_ID_KEY);
  } catch { /* Browsers may disable storage. */ }
  try { writeCookie(ACQUISITION_COOKIE, '', 0); } catch { /* No tracking is essential. */ }
}

export function getAnalyticsConsent(): 'granted' | 'denied' | 'pending' {
  if (typeof window === 'undefined') return 'pending';
  if (browserPrivacyOptOut()) { clearAcquisition(); return 'denied'; }
  const value = cookieValue(document.cookie, ANALYTICS_CONSENT_COOKIE) ?? memoryConsent;
  if (value !== 'granted') clearAcquisition();
  return value === 'granted' ? 'granted' : value === 'denied' ? 'denied' : 'pending';
}

export function setAnalyticsConsent(consent: 'granted' | 'denied') {
  if (typeof window === 'undefined') return;
  memoryConsent = browserPrivacyOptOut() ? 'denied' : consent;
  try { writeCookie(ANALYTICS_CONSENT_COOKIE, memoryConsent, 365 * 24 * 60 * 60); } catch { /* Keep the in-memory choice. */ }
  if (memoryConsent === 'denied') {
    clearAcquisition(); pendingFirstTouch = null; pendingLatestTouch = null;
  }
  else {
    getAcquisitionAttribution();
    trackClientEvent({ eventName: 'visitor_identified' });
  }
  window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
}

/** Only explicit consent permits persistent identities and conversion linkage. */
export function getAcquisitionAttribution(): AcquisitionAttribution | null {
  if (typeof window === 'undefined' || getAnalyticsConsent() !== 'granted') return null;
  const now = Date.now();
  const location = window.location.href;
  initialLocation ??= location;
  let stored = memoryRecord;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && raw.length <= 3500) {
      const parsed = JSON.parse(raw) as Partial<StoredAcquisition>;
      const attribution = normalizeAttribution(parsed.attribution, now);
      if (attribution && typeof parsed.lastActivityAt === 'number' && parsed.lastActivityAt <= now + 5 * 60_000) {
        stored = { attribution, lastActivityAt: parsed.lastActivityAt };
      } else {
        clearAcquisition();
        stored = null;
      }
    }
  } catch { /* In-memory tracking remains optional. */ }
  if (stored && !normalizeAttribution(stored.attribution, now)) { clearAcquisition(); stored = null; }
  if (!stored) {
    const fromCookie = parseAcquisitionCookie(document.cookie, {}, now);
    if (fromCookie) stored = { attribution: { ...fromCookie, sessionId: createAnalyticsId() }, lastActivityAt: now };
  }
  const touch = !stored || location !== lastCapturedLocation ? deriveAcquisitionTouch({ url: location,
    referrer: location === initialLocation ? document.referrer : null, now }) : null;
  if (!stored) {
    if (!touch) return null;
    const firstTouch = normalizeTouch(pendingFirstTouch, now) ?? touch;
    const latestTouch = touch.source !== 'direct' ? touch : normalizeTouch(pendingLatestTouch, now) ?? touch;
    let visitorId: string | null = null;
    try { visitorId = window.localStorage.getItem(ANONYMOUS_ID_KEY); } catch { /* Optional storage. */ }
    stored = { attribution: { version: 2, visitorId: visitorId && UUID_PATTERN.test(visitorId) ? visitorId : createAnalyticsId(),
      sessionId: createAnalyticsId(), firstTouch, latestTouch,
      expiresAt: new Date(Date.parse(firstTouch.capturedAt) + ATTRIBUTION_MAX_AGE_MS).toISOString() }, lastActivityAt: now };
  } else {
    if (now - stored.lastActivityAt >= SESSION_IDLE_MS) stored.attribution.sessionId = createAnalyticsId();
    // Direct navigation and service/auth returns never erase a known acquisition.
    if (touch && touch.source !== 'direct') stored.attribution.latestTouch = touch;
    stored.lastActivityAt = now;
  }
  lastCapturedLocation = location;
  memoryRecord = stored;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    window.localStorage.setItem(ANONYMOUS_ID_KEY, stored.attribution.visitorId);
  } catch { /* Analytics must never break sign-in, subscription, or navigation. */ }
  try { writeCookie(ACQUISITION_COOKIE, JSON.stringify(stored.attribution), (Date.parse(stored.attribution.expiresAt) - now) / 1000); } catch { /* Cookies may be disabled too. */ }
  return stored.attribution;
}

export function getAnonymousId() { return getAcquisitionAttribution()?.visitorId ?? null; }
export function getSessionId() { return getAcquisitionAttribution()?.sessionId ?? null; }

export function trackClientEvent(event: ClientAnalyticsEvent) {
  if (typeof window === 'undefined') return;
  try {
    const pagePath = normalizePagePath(event.pagePath ?? window.location.pathname);
    const currentTouch = deriveAcquisitionTouch({ url: window.location.href,
      referrer: initialLocation === null || initialLocation === window.location.href ? document.referrer : null });
    initialLocation ??= window.location.href;
    if (!pagePath || isExcludedAnalyticsPath(pagePath) || !currentTouch || !PUBLIC_ANALYTICS_EVENTS.has(event.eventName)
      || isKnownTestTraffic(window.location.hostname, navigator.userAgent)) return;
    pendingFirstTouch ??= currentTouch;
    if (currentTouch.source !== 'direct' || !pendingLatestTouch) pendingLatestTouch = currentTouch;
    const attribution = getAcquisitionAttribution();
    if (!attribution && event.eventName !== 'page_view') return;
    if (navigationLocation !== window.location.href) {
      navigationLocation = window.location.href;
      navigationId = createAnalyticsId();
    }
    const touch = attribution?.latestTouch ?? currentTouch;
    const payload = JSON.stringify({
      eventId: event.eventName === 'page_view' ? navigationId : event.eventName === 'visitor_identified' ? identifiedVisitId(navigationId!) : createAnalyticsId(), eventName: event.eventName,
      anonymousId: attribution?.visitorId ?? null, sessionId: attribution?.sessionId ?? null,
      pagePath, referrer: touch.referrerDomain, utmSource: touch.source, utmMedium: touch.medium, utmCampaign: touch.campaign,
      metadata: { ...sanitizePublicMetadata(event.metadata), navigation_id: navigationId, event_version: 2, traffic_type: 'human', tracking_mode: attribution ? 'consented' : 'aggregate',
        content_group: contentGroup(pagePath), ...(attribution ? { attribution } : { aggregate_touch: currentTouch }) },
    });
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(ANALYTICS_ENDPOINT, new Blob([payload], { type: 'application/json' }))) return;
    void fetch(ANALYTICS_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
  } catch { /* Capture and transport failures never affect product behavior. */ }
}
