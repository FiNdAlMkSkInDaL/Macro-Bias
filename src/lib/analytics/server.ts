import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AnalyticsMetadata = Record<string, unknown>;

type LogMarketingEventInput = {
  id?: string;
  timeoutMs?: number;
  /** Internal absolute helper deadline, never taken from browser metadata. */
  deadlineAt?: number;
  createdAt?: string;
  anonymousId?: string | null;
  eventName: string;
  metadata?: AnalyticsMetadata;
  pagePath: string;
  referrer?: string | null;
  sessionId?: string | null;
  subscriberEmail?: string | null;
  utmCampaign?: string | null;
  utmMedium?: string | null;
  utmSource?: string | null;
};

function normalizeOptionalText(value: string | null | undefined, maxLength = 512) {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  return normalizedValue.slice(0, maxLength);
}

function normalizeEventName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "_").slice(0, 64);
}

function idEventTimeout(input: LogMarketingEventInput) {
  let remaining = input.timeoutMs ?? 5_000;
  if (!Number.isFinite(remaining) || remaining < 1) throw new Error('Acquisition analytics is temporarily unavailable. Please retry.');
  if (input.deadlineAt !== undefined) {
    if (!Number.isFinite(input.deadlineAt)) throw new Error('Acquisition analytics is temporarily unavailable. Please retry.');
    remaining = Math.min(remaining, input.deadlineAt - Date.now());
  }
  if (remaining < 1) throw new Error('Acquisition analytics is temporarily unavailable. Please retry.');
  return Math.min(5_000, Math.floor(remaining));
}

export async function logMarketingEvent(input: LogMarketingEventInput) {
  const eventName = normalizeEventName(input.eventName);
  const pagePath = normalizeOptionalText(input.pagePath, 256);

  if (!eventName || !pagePath) {
    return;
  }

  const row = {
    ...(input.id ? { id: input.id } : {}),
    ...(input.createdAt ? { created_at: input.createdAt } : {}),
    anonymous_id: normalizeOptionalText(input.anonymousId, 128),
    event_name: eventName,
    metadata: input.metadata ?? {},
    page_path: pagePath,
    referrer: normalizeOptionalText(input.referrer, 1024),
    session_id: normalizeOptionalText(input.sessionId, 128),
    subscriber_email: normalizeOptionalText(input.subscriberEmail?.toLowerCase(), 320),
    utm_campaign: normalizeOptionalText(input.utmCampaign, 128),
    utm_medium: normalizeOptionalText(input.utmMedium, 128),
    utm_source: normalizeOptionalText(input.utmSource, 128),
  };
  // Only stable-ID acquisition/capture writes opt into a timeout. Existing
  // newsletter/referral diagnostics without an ID keep their default client.
  const supabase = input.id
    ? createSupabaseAdminClient({ timeoutMs: idEventTimeout(input) })
    : createSupabaseAdminClient();
  // Stable server/client event IDs replay safely without replacing the original
  // attribution or timestamp. Ordinary historical events retain their behavior.
  let result;
  try {
    result = input.id
      ? await supabase.from("marketing_event_log").upsert(row, { onConflict: 'id', ignoreDuplicates: true }).select('id')
      : await supabase.from("marketing_event_log").insert(row).select('id');
  } catch (error) {
    if (input.id) throw new Error('Acquisition analytics is temporarily unavailable. Please retry.');
    throw error;
  }
  const { error, data } = result;

  if (error) {
    if (input.id) throw new Error('Acquisition analytics is temporarily unavailable. Please retry.');
    throw new Error(`Failed to log marketing event: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}
