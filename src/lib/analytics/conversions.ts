import 'server-only';

import { createHash } from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import type Stripe from 'stripe';

import {
  attributionMetadata,
  ATTRIBUTION_MAX_AGE_MS,
  isKnownTestTraffic,
  normalizeAttribution,
  normalizePagePath,
  parseAcquisitionCookie,
  type AcquisitionAttribution,
} from '@/lib/analytics/attribution';
import { logMarketingEvent } from '@/lib/analytics/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// This version only attributes registrations created after capture was added.
// Existing accounts remain in authoritative historical totals with Unknown source.
export const ACQUISITION_CAPTURE_STARTED_AT = '2026-10-04T19:48:00.000Z';

type AcquisitionBudget = { deadlineAt: number };
const DB_REQUEST_TIMEOUT_MS = 5_000;
function acquisitionBudget(durationMs: number): AcquisitionBudget {
  return { deadlineAt: Date.now() + durationMs };
}
function retryableAnalyticsError() {
  return new Error('Acquisition analytics is temporarily unavailable. Please retry.');
}
function remainingTimeout(budget: AcquisitionBudget) {
  const remaining = Math.floor(budget.deadlineAt - Date.now());
  if (remaining < 1) throw retryableAnalyticsError();
  return Math.min(DB_REQUEST_TIMEOUT_MS, remaining);
}

export function conversionEntityKey(kind: 'subscriber' | 'account' | 'paid', value: string) {
  return `${kind}:${createHash('sha256').update(value.trim().toLowerCase()).digest('hex')}`;
}

export function conversionEventId(eventName: string, entityKey: string) {
  const hex = createHash('sha256').update(`macro-bias:acquisition:v2:${eventName}:${entityKey}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function requestAcquisition(headers: Headers) {
  if (requestIsTestTraffic(headers)) return null;
  return parseAcquisitionCookie(headers.get('cookie'), {
    dnt: headers.get('dnt'), gpc: headers.get('sec-gpc'),
  });
}

function requestIsTestTraffic(headers: Headers) {
  return isKnownTestTraffic((headers.get('host') ?? '').split(':')[0], headers.get('user-agent') ?? '');
}

function attributionExplicitlyDenied(headers: Headers) {
  return headers.get('dnt') === '1' || headers.get('sec-gpc') === '1'
    || /(?:^|;\s*)mb_analytics_consent=denied(?:;|$)/.test(headers.get('cookie') ?? '');
}

export function mergeAcquisition(
  existing: AcquisitionAttribution | null,
  current: AcquisitionAttribution,
): AcquisitionAttribution {
  if (!existing) return current;
  const firstTouch = existing.firstTouch.capturedAt < current.firstTouch.capturedAt ? existing.firstTouch : current.firstTouch;
  const latestTouch = current.latestTouch.source === 'direct' && existing.latestTouch.source !== 'direct'
    ? existing.latestTouch
    : existing.latestTouch.source === 'direct' && current.latestTouch.source !== 'direct'
      ? current.latestTouch
      : existing.latestTouch.capturedAt > current.latestTouch.capturedAt ? existing.latestTouch : current.latestTouch;
  return {
    ...current,
    firstTouch,
    latestTouch,
    expiresAt: new Date(Math.min(Date.parse(current.expiresAt), Date.parse(firstTouch.capturedAt) + ATTRIBUTION_MAX_AGE_MS)).toISOString(),
  };
}

async function storedIdentity(entityKey: string, budget: AcquisitionBudget) {
  const admin = createSupabaseAdminClient({ timeoutMs: remainingTimeout(budget) });
  const { data, error } = await admin.from('marketing_event_log').select('metadata')
    .eq('id', conversionEventId('acquisition_identity', entityKey)).maybeSingle();
  if (error) throw retryableAnalyticsError();
  return normalizeAttribution(data?.metadata?.attribution);
}

async function bindIdentity(entityKey: string, attribution: AcquisitionAttribution | null, budget: AcquisitionBudget) {
  if (!attribution) return;
  const existing = await storedIdentity(entityKey, budget);
  const merged = mergeAcquisition(existing, attribution);
  const admin = createSupabaseAdminClient({ timeoutMs: remainingTimeout(budget) });
  const { error } = await admin.from('marketing_event_log').upsert({
    id: conversionEventId('acquisition_identity', entityKey),
    event_name: 'acquisition_identity',
    page_path: merged.latestTouch.landingPath,
    anonymous_id: merged.visitorId,
    session_id: merged.sessionId,
    metadata: { ...attributionMetadata(merged, merged.latestTouch.landingPath), entity_key: entityKey, confirmed: true },
  }, { onConflict: 'id' });
  if (error) throw retryableAnalyticsError();
}

async function recordConversion(input: {
  eventName: 'email_subscribed' | 'subscriber_reactivated' | 'account_created' | 'paid_conversion';
  entityKey: string;
  attribution: AcquisitionAttribution | null;
  pagePath: string;
  createdAt?: string;
  metadata: Record<string, unknown>;
  testTraffic?: boolean;
}, budget: AcquisitionBudget) {
  const pagePath = normalizePagePath(input.pagePath) ?? '/';
  const attribution = input.attribution;
  return logMarketingEvent({
    timeoutMs: remainingTimeout(budget),
    deadlineAt: budget.deadlineAt,
    id: conversionEventId(input.eventName, input.entityKey),
    createdAt: input.createdAt,
    eventName: input.eventName,
    pagePath,
    anonymousId: attribution?.visitorId,
    sessionId: attribution?.sessionId,
    referrer: attribution?.latestTouch.referrerDomain,
    utmSource: attribution?.latestTouch.source,
    utmMedium: attribution?.latestTouch.medium,
    utmCampaign: attribution?.latestTouch.campaign,
    metadata: {
      ...attributionMetadata(attribution, pagePath),
      ...input.metadata,
      traffic_type: input.testTraffic ? 'test' : 'human',
      confirmed: true,
      entity_key: input.entityKey,
    },
  });
}

export async function recordSubscriberAcquisition(input: {
  email: string;
  createdAt: string;
  newSubscriber: boolean;
  reactivated?: boolean;
  headers: Headers;
  pagePath: string;
  stocksOptedIn: boolean;
  cryptoOptedIn: boolean;
}) {
  const budget = acquisitionBudget(10_000);
  const entityKey = conversionEntityKey('subscriber', input.email);
  const attribution = requestAcquisition(input.headers);
  if ((input.newSubscriber || input.reactivated) && (input.stocksOptedIn || input.cryptoOptedIn)) {
    await recordConversion({
      eventName: input.newSubscriber ? 'email_subscribed' : 'subscriber_reactivated',
      entityKey,
      attribution,
      pagePath: input.pagePath,
      createdAt: input.newSubscriber ? input.createdAt : undefined,
      metadata: {
        conversion_kind: input.newSubscriber ? 'new_subscriber' : 'reactivation',
        confirmation: 'subscriber_record_saved',
        stocks_opted_in: input.stocksOptedIn,
        crypto_opted_in: input.cryptoOptedIn,
        content_group: input.stocksOptedIn && input.cryptoOptedIn ? 'both' : input.cryptoOptedIn ? 'crypto' : 'stocks',
      },
      testTraffic: requestIsTestTraffic(input.headers),
    }, budget);
  }
  // Public preference updates cannot prove ownership of an existing email.
  // Verified account flows bind their own email separately; only a genuinely
  // new eligible newsletter insert establishes this initial subscriber bridge.
  if (input.newSubscriber && (input.stocksOptedIn || input.cryptoOptedIn)) {
    await bindIdentity(entityKey, attribution, budget);
  }
}

function signupAcquisition(user: User) {
  const attribution = normalizeAttribution(user.user_metadata?.acquisition_v2);
  if (!attribution) return null;
  // A later login/campaign cannot become the source of an earlier registration.
  return Date.parse(attribution.latestTouch.capturedAt) <= Date.parse(user.created_at) + 300_000
    ? attribution : null;
}

export async function confirmAccountAcquisition(input: {
  user: User;
  headers: Headers;
  flowType?: string | null;
}) {
  const budget = acquisitionBudget(10_000);
  const { user, headers, flowType } = input;
  if (flowType === 'recovery' || !user.email || !user.email_confirmed_at) return;
  const current = requestAcquisition(headers);
  const original = attributionExplicitlyDenied(headers) ? null : signupAcquisition(user);
  const createdAt = Date.parse(user.created_at);
  const isNewVersionAccount = Number.isFinite(createdAt)
    && createdAt >= Date.parse(ACQUISITION_CAPTURE_STARTED_AT)
    && createdAt <= Date.now() + 300_000;
  if (isNewVersionAccount) {
    const attribution = original ?? (current && Date.parse(current.latestTouch.capturedAt) <= createdAt + 300_000 ? current : null);
    await recordConversion({
      eventName: 'account_created',
      entityKey: conversionEntityKey('account', user.id),
      attribution,
      pagePath: attribution?.latestTouch.landingPath ?? '/login',
      createdAt: user.created_at,
      metadata: { conversion_kind: 'new_account', confirmation: 'verified_auth_user', account_created_at: user.created_at },
      testTraffic: requestIsTestTraffic(headers),
    }, budget);
  }
  // Account/email linking occurs only with present consent, never on reset flows.
  if (current) {
    await bindIdentity(conversionEntityKey('account', user.id), current, budget);
    await bindIdentity(conversionEntityKey('subscriber', user.email), current, budget);
  }
}

export async function checkoutAcquisition(user: User, headers: Headers) {
  const budget = acquisitionBudget(5_000);
  const current = requestAcquisition(headers);
  if (!current) return null;
  const [account, subscriber] = await Promise.all([
    storedIdentity(conversionEntityKey('account', user.id), budget),
    user.email ? storedIdentity(conversionEntityKey('subscriber', user.email), budget) : Promise.resolve(null),
  ]);
  return mergeAcquisition(subscriber, mergeAcquisition(account, current));
}

// Stripe limits each metadata value to 500 characters. Each normalized touch is
// split into bounded scalar fields rather than embedding a large JSON document.
export function stripeAcquisitionMetadata(attribution: AcquisitionAttribution | null): Record<string, string> {
  if (!attribution) return {};
  const metadata: Record<string, string> = {
    mb_acq_version: '2', mb_visitor: attribution.visitorId, mb_session: attribution.sessionId, mb_expires: attribution.expiresAt,
  };
  for (const [prefix, touch] of [['first', attribution.firstTouch], ['latest', attribution.latestTouch]] as const) {
    for (const [key, value] of Object.entries(touch)) {
      if (typeof value === 'string') metadata[`mb_${prefix}_${key}`] = value.slice(0, 256);
    }
  }
  return metadata;
}

export function attributionFromStripeMetadata(metadata?: Stripe.Metadata | null) {
  if (metadata?.mb_acq_version !== '2') return null;
  const touch = (prefix: 'first' | 'latest') => ({
    source: metadata[`mb_${prefix}_source`], medium: metadata[`mb_${prefix}_medium`],
    campaign: metadata[`mb_${prefix}_campaign`] ?? null, content: metadata[`mb_${prefix}_content`] ?? null,
    referrerDomain: metadata[`mb_${prefix}_referrerDomain`] ?? null,
    landingPath: metadata[`mb_${prefix}_landingPath`], capturedAt: metadata[`mb_${prefix}_capturedAt`],
  });
  return normalizeAttribution({
    version: 2, visitorId: metadata.mb_visitor, sessionId: metadata.mb_session, expiresAt: metadata.mb_expires,
    firstTouch: touch('first'), latestTouch: touch('latest'),
  });
}

export function isActualPaidInvoice(invoice: Stripe.Invoice) {
  const legacyInvoice = invoice as Stripe.Invoice & { paid_out_of_band?: boolean };
  return invoice.livemode === true && invoice.status === 'paid' && invoice.amount_paid > 0
    && legacyInvoice.paid_out_of_band !== true && Boolean(invoice.status_transitions?.paid_at);
}

export async function isFirstPaidInvoice(stripe: Stripe, invoice: Stripe.Invoice, customerId: string, budget: AcquisitionBudget = acquisitionBudget(20_000)) {
  if (!isActualPaidInvoice(invoice)) return false;
  const paidAt = invoice.status_transitions.paid_at!;
  let cursor: string | undefined;
  // Fail closed if an unusually large history cannot be fully checked. No
  // renewal is labelled a new conversion just because capture started recently.
  try {
    for (let page = 0; page < 20; page += 1) {
      const invoices: Stripe.ApiList<Stripe.Invoice> = await stripe.invoices.list({
        customer: customerId, status: 'paid', limit: 100, ...(cursor ? { starting_after: cursor } : {}),
      }, { timeout: remainingTimeout(budget), maxNetworkRetries: 0 });
      if (invoices.data.some((prior) => prior.id !== invoice.id && isActualPaidInvoice(prior)
        && ((prior.status_transitions.paid_at ?? Infinity) < paidAt
          || (prior.status_transitions.paid_at === paidAt && prior.created < invoice.created)))) return false;
      if (!invoices.has_more) return true;
      cursor = invoices.data.at(-1)?.id;
      if (!cursor) return false;
    }
  } catch {
    // Billing was already synchronized by the webhook. Returning 500 here is
    // deliberate: Stripe retries an uncertain analytics read without inventing
    // a first payment or abandoning an unbounded provider request.
    throw retryableAnalyticsError();
  }
  return false;
}

export async function recordPaidAcquisition(input: {
  stripe: Stripe;
  invoice: Stripe.Invoice;
  userId: string;
  customerId: string | null;
  attribution: AcquisitionAttribution | null;
}) {
  const budget = acquisitionBudget(20_000);
  if (!input.customerId || !(await isFirstPaidInvoice(input.stripe, input.invoice, input.customerId, budget))) return;
  await recordConversion({
    eventName: 'paid_conversion',
    entityKey: conversionEntityKey('paid', input.userId),
    attribution: input.attribution,
    pagePath: input.attribution?.latestTouch.landingPath ?? '/pricing',
    createdAt: new Date(input.invoice.status_transitions.paid_at! * 1000).toISOString(),
    metadata: {
      conversion_kind: 'first_paid_upgrade', confirmation: 'stripe_invoice_paid', first_paid_verified: true,
      stripe_invoice_id: input.invoice.id, amount_minor: input.invoice.amount_paid, currency: input.invoice.currency,
    },
  }, budget);
}
