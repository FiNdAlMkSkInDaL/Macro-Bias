import { NextResponse } from 'next/server';

import { getUserSubscriptionStatus } from '@/lib/billing/subscription';
import { loadReferralHub } from '@/lib/referral/load-referral-hub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Simple in-memory rate limiter (soft protection for serverless)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 });
  }

  const url = new URL(request.url);
  const requested = url.searchParams.get('email')?.trim().toLowerCase() ?? '';
  const { isPro, user } = await getUserSubscriptionStatus();
  const sessionEmail = user?.email?.trim().toLowerCase() ?? '';
  const email = requested || sessionEmail;

  if (!email || email.length < 4 || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email parameter is required.' }, { status: 400 });
  }

  const result = await loadReferralHub(email, {
    proOverride: Boolean(sessionEmail && sessionEmail === email && isPro),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.hub);
}
