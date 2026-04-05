import { NextResponse } from 'next/server';

import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { getStripeClient } from '../../../../lib/stripe';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';

export const runtime = 'nodejs';

const PORTAL_RETURN_URL = 'https://macro-bias.com/dashboard';
const IGNORED_PROFILE_LOOKUP_ERROR_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);

function shouldIgnoreProfileLookupError(error: { code?: string }) {
  return error.code != null && IGNORED_PROFILE_LOOKUP_ERROR_CODES.has(error.code);
}

async function getStripeCustomerIdFromProfiles(userId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    if (shouldIgnoreProfileLookupError(error)) {
      return null;
    }

    throw new Error(`Failed to load billing profile: ${error.message}`);
  }

  return data?.stripe_customer_id ?? null;
}

async function getStripeCustomerIdFromUsers(userId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('users')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load user billing record: ${error.message}`);
  }

  return data?.stripe_customer_id ?? null;
}

async function getStripeCustomerId(userId: string) {
  return (await getStripeCustomerIdFromProfiles(userId)) ?? (await getStripeCustomerIdFromUsers(userId));
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const stripeCustomerId = await getStripeCustomerId(user.id);

    if (!stripeCustomerId) {
      return NextResponse.json(
        { error: 'No Stripe customer record was found for this account.' },
        { status: 400 },
      );
    }

    const stripe = getStripeClient();
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: PORTAL_RETURN_URL,
    });

    if (!portalSession.url) {
      throw new Error('Stripe billing portal session was created without a redirect URL.');
    }

    return NextResponse.redirect(portalSession.url, { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create a billing portal session.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}