import { NextResponse } from 'next/server';

import { getStripeCustomerId } from '../../../../lib/billing/stripe-customer';
import { getStripeClient } from '../../../../lib/stripe';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';

const PORTAL_RETURN_URL = 'https://macro-bias.com/dashboard';

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
