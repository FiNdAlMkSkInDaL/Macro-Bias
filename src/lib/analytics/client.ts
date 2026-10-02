"use client";

const ANALYTICS_ENDPOINT = "/api/analytics/track";
const ANONYMOUS_ID_KEY = "macro-bias.anonymous-id";
const SESSION_ID_KEY = "macro-bias.session-id";

type AnalyticsMetadata = Record<string, unknown>;

export type ClientAnalyticsEvent = {
  eventName: string;
  metadata?: AnalyticsMetadata;
  pagePath?: string;
  referrer?: string | null;
  subscriberEmail?: string | null;
};

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getStorageValue(storage: Storage, key: string) {
  const existingValue = storage.getItem(key);

  if (existingValue) {
    return existingValue;
  }

  const nextValue = createId();
  storage.setItem(key, nextValue);
  return nextValue;
}

export function getAnonymousId() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return getStorageValue(window.localStorage, ANONYMOUS_ID_KEY);
  } catch {
    return createId();
  }
}

export function getSessionId() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return getStorageValue(window.sessionStorage, SESSION_ID_KEY);
  } catch {
    return createId();
  }
}

function getUtmValues() {
  if (typeof window === "undefined") {
    return {
      utmCampaign: null,
      utmMedium: null,
      utmSource: null,
    };
  }

  const searchParams = new URLSearchParams(window.location.search);

  return {
    utmCampaign: searchParams.get("utm_campaign"),
    utmMedium: searchParams.get("utm_medium"),
    utmSource: searchParams.get("utm_source"),
  };
}

export function trackClientEvent(event: ClientAnalyticsEvent) {
  if (typeof window === "undefined") {
    return;
  }

  // Authentication routes must never send email-link credentials, continuations
  // or recovery form interactions to marketing analytics.
  if (/^\/(?:auth(?:\/|$)|forgot-password(?:\/|$)|reset-password(?:\/|$))/.test(window.location.pathname)) return;
  const currentParams = new URLSearchParams(window.location.search);
  if (['token_hash', 'token', 'access_token', 'refresh_token', 'code'].some((key) => currentParams.has(key))) return;

  let referrer: string | null = event.referrer ?? document.referrer ?? null;
  if (referrer) {
    try {
      const url = new URL(referrer);
      if (/^\/(?:auth(?:\/|$)|forgot-password(?:\/|$)|reset-password(?:\/|$))/.test(url.pathname)) referrer = null;
      else {
        ['token_hash', 'token', 'access_token', 'refresh_token', 'code'].forEach((key) => url.searchParams.delete(key));
        url.hash = '';
        referrer = url.toString();
      }
    } catch { referrer = null; }
  }

  const payload = JSON.stringify({
    anonymousId: getAnonymousId(),
    eventName: event.eventName,
    metadata: event.metadata ?? {},
    pagePath: event.pagePath ?? window.location.pathname,
    referrer,
    sessionId: getSessionId(),
    subscriberEmail: event.subscriberEmail ?? null,
    ...getUtmValues(),
  });

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon(ANALYTICS_ENDPOINT, blob);
    return;
  }

  void fetch(ANALYTICS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // Avoid surfacing analytics transport failures to the user.
  });
}
