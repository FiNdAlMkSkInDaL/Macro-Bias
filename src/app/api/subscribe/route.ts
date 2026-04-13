import { NextResponse } from 'next/server';

import { logMarketingEvent } from '@/lib/analytics/server';
import { enrollSubscriberInWelcomeDrip, dispatchPendingWelcomeDripEmails } from '@/lib/marketing/welcome-drip';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SUBSCRIBE_SUCCESS_MESSAGE = '[SYSTEM OUTPUT]: EMAIL ADDED TO PROTOCOL.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SubscribeRequestBody = {
  email?: unknown;
  pagePath?: unknown;
};

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(email: string) {
  return email.length > 3 && email.length <= 320 && EMAIL_PATTERN.test(email);
}

function normalizePagePath(value: unknown) {
  return typeof value === 'string' && value.startsWith('/') ? value.slice(0, 256) : null;
}

function getReferrerPagePath(referrer: string | null) {
  if (!referrer) {
    return null;
  }

  try {
    const url = new URL(referrer);
    return `${url.pathname}${url.search}`.slice(0, 256);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let payload: SubscribeRequestBody;

  try {
    payload = (await request.json()) as SubscribeRequestBody;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const email = normalizeEmail(payload.email);
  const referrer = request.headers.get('referer');
  const pagePath = normalizePagePath(payload.pagePath) ?? getReferrerPagePath(referrer) ?? '/emails';

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from('free_subscribers').upsert(
    {
      email,
      status: 'active',
      tier: 'free',
    },
    {
      onConflict: 'email',
    },
  );

  if (error) {
    return NextResponse.json(
      { error: `Unable to add email to protocol: ${error.message}` },
      { status: 500 },
    );
  }

  const sideEffects = await Promise.allSettled([
    enrollSubscriberInWelcomeDrip(email),
    logMarketingEvent({
      eventName: 'email_subscribed',
      metadata: {
        source: 'subscribe_api',
      },
      pagePath,
      referrer,
      subscriberEmail: email,
    }),
  ]);

  for (const result of sideEffects) {
    if (result.status === 'rejected') {
      console.error('[subscribe] post-subscribe side effect failed', result.reason);
    }
  }

  try {
    await dispatchPendingWelcomeDripEmails({ email, limit: 1 });
  } catch (dispatchError) {
    console.error('[subscribe] immediate welcome drip dispatch failed', dispatchError);
  }

  return NextResponse.json({ message: SUBSCRIBE_SUCCESS_MESSAGE, ok: true }, { status: 200 });
}
