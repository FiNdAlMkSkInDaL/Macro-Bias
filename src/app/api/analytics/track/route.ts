import { NextResponse } from "next/server";

import { logMarketingEvent } from "@/lib/analytics/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const EVENT_NAME_PATTERN = /^[a-zA-Z0-9:_-]{2,64}$/;

type TrackAnalyticsRequestBody = {
  anonymousId?: unknown;
  eventName?: unknown;
  metadata?: unknown;
  pagePath?: unknown;
  referrer?: unknown;
  sessionId?: unknown;
  subscriberEmail?: unknown;
  utmCampaign?: unknown;
  utmMedium?: unknown;
  utmSource?: unknown;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown) {
  const normalizedValue = normalizeText(value);
  return normalizedValue || null;
}

function normalizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export async function POST(request: Request) {
  let payload: TrackAnalyticsRequestBody;

  try {
    payload = (await request.json()) as TrackAnalyticsRequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const eventName = normalizeText(payload.eventName);
  const pagePath = normalizeText(payload.pagePath);

  if (!EVENT_NAME_PATTERN.test(eventName)) {
    return NextResponse.json({ error: "Invalid event name." }, { status: 400 });
  }

  if (!pagePath.startsWith("/")) {
    return NextResponse.json({ error: "Invalid page path." }, { status: 400 });
  }

  await logMarketingEvent({
    anonymousId: normalizeOptionalText(payload.anonymousId),
    eventName,
    metadata: normalizeMetadata(payload.metadata),
    pagePath,
    referrer: normalizeOptionalText(payload.referrer),
    sessionId: normalizeOptionalText(payload.sessionId),
    subscriberEmail: normalizeOptionalText(payload.subscriberEmail),
    utmCampaign: normalizeOptionalText(payload.utmCampaign),
    utmMedium: normalizeOptionalText(payload.utmMedium),
    utmSource: normalizeOptionalText(payload.utmSource),
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
