import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AnalyticsMetadata = Record<string, unknown>;

type LogMarketingEventInput = {
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

export async function logMarketingEvent(input: LogMarketingEventInput) {
  const eventName = normalizeEventName(input.eventName);
  const pagePath = normalizeOptionalText(input.pagePath, 256);

  if (!eventName || !pagePath) {
    return;
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("marketing_event_log").insert({
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
  });

  if (error) {
    throw new Error(`Failed to log marketing event: ${error.message}`);
  }
}
