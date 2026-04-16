import { NextResponse } from 'next/server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logMarketingEvent } from '@/lib/analytics/server';
import { enrollSubscriberInWelcomeDrip, dispatchPendingWelcomeDripEmails } from '@/lib/marketing/welcome-drip';
import { REFERRAL_CODE_MAX_LENGTH } from '@/lib/referral/constants';
import { generateReferralCode } from '@/lib/referral/generate-referral-code';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SUBSCRIBE_SUCCESS_MESSAGE = '[SYSTEM OUTPUT]: EMAIL ADDED TO PROTOCOL.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SubscribeRequestBody = {
  email?: unknown;
  pagePath?: unknown;
  stocksOptedIn?: unknown;
  cryptoOptedIn?: unknown;
  ref?: unknown;
};

function parseBooleanPreference(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return defaultValue;
}

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
  const stocksOptedIn = parseBooleanPreference(payload.stocksOptedIn, true);
  const cryptoOptedIn = parseBooleanPreference(payload.cryptoOptedIn, false);

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from('free_subscribers').upsert(
    {
      email,
      status: 'active',
      tier: 'free',
      stocks_opted_in: stocksOptedIn,
      crypto_opted_in: cryptoOptedIn,
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

  // Generate referral code for new subscriber (if they don't already have one)
  try {
    const newReferralCode = generateReferralCode();
    const { error: codeError } = await supabase
      .from('free_subscribers')
      .update({ referral_code: newReferralCode })
      .eq('email', email)
      .is('referral_code', null);

    if (codeError) {
      // Retry once with a new code in case of collision
      const retryCode = generateReferralCode();
      await supabase
        .from('free_subscribers')
        .update({ referral_code: retryCode })
        .eq('email', email)
        .is('referral_code', null);
    }
  } catch (codeGenError) {
    console.error('[subscribe] referral code generation failed', codeGenError);
  }

  // Process referral attribution (if ref param provided)
  const refCode = typeof payload.ref === 'string'
    ? payload.ref.trim().toLowerCase().slice(0, REFERRAL_CODE_MAX_LENGTH)
    : null;
  if (refCode) {
    try {
      await processReferralAttribution(supabase, email, refCode, pagePath);
    } catch (refError) {
      console.error('[subscribe] referral attribution failed (non-fatal)', refError);
    }
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

async function processReferralAttribution(
  supabase: SupabaseClient,
  referredEmail: string,
  referralCode: string,
  landingPagePath: string,
) {
  // 1. Look up referrer by code
  const { data: referrer } = await supabase
    .from('free_subscribers')
    .select('email, status')
    .eq('referral_code', referralCode)
    .single();

  if (!referrer || referrer.status !== 'active') {
    console.log('[subscribe] invalid or inactive referral code:', referralCode);
    return;
  }

  // 2. Prevent self-referral
  if (referrer.email === referredEmail) {
    console.log('[subscribe] self-referral blocked:', referredEmail);
    return;
  }

  // 3. Check if this email was already referred by someone
  const { data: existingReferral } = await supabase
    .from('referrals')
    .select('id')
    .eq('referred_email', referredEmail)
    .limit(1)
    .maybeSingle();

  if (existingReferral) {
    console.log('[subscribe] email already referred, skipping:', referredEmail);
    return;
  }

  // 4. Create the referral record
  const { error } = await supabase.from('referrals').insert({
    referrer_email: referrer.email,
    referred_email: referredEmail,
    status: 'pending',
  });

  if (error) {
    console.error('[subscribe] referral insert failed', error);
    return;
  }

  // 5. Set referred_by on the subscriber
  await supabase
    .from('free_subscribers')
    .update({ referred_by: referrer.email })
    .eq('email', referredEmail);

  // 6. Log analytics event
  await logMarketingEvent({
    eventName: 'referral_attributed',
    pagePath: landingPagePath,
    subscriberEmail: referredEmail,
    metadata: {
      landing_page_path: landingPagePath,
      referrer_email: referrer.email,
      referral_code: referralCode,
    },
  });
}
