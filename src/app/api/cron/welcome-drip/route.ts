import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { dispatchPendingWelcomeDripEmails } from "@/lib/marketing/welcome-drip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function getOptionalServerEnv(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isAuthorizedCronRequest(request: NextRequest) {
  const expectedSecret = getOptionalServerEnv("CRON_SECRET") ?? getOptionalServerEnv("PUBLISH_CRON_SECRET");

  if (!expectedSecret) {
    throw new Error("Missing CRON_SECRET. Configure it before enabling the welcome drip cron route.");
  }

  const providedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.nextUrl.searchParams.get("secret") ?? "";
  const expectedBuffer = Buffer.from(expectedSecret);
  const providedBuffer = Buffer.from(providedSecret);

  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await dispatchPendingWelcomeDripEmails({ limit: 100 });

  return NextResponse.json({ ok: true, result }, { status: 200 });
}
