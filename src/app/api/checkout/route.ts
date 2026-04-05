import { NextResponse } from 'next/server';

import {
  getUserSubscriptionStatus,
  isSubscriptionActive,
} from '../../../lib/billing/subscription';
import { getAppUrl } from '../../../lib/server-env';
import { createSupabaseAdminClient } from '../../../lib/supabase/admin';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import {
  getStripeClient,
  getStripePriceId,
  type StripeBillingPlan,
} from '../../../lib/stripe';

type CheckoutResult =
  | {
      error: NextResponse;
    }
  | {
      url: string;
    };

function getCheckoutPlan(request: Request): StripeBillingPlan {
  const requestedPlan = new URL(request.url).searchParams.get('plan');

  return requestedPlan === 'annual' ? 'annual' : 'monthly';
}

async function buildCheckoutSession(request: Request): Promise<CheckoutResult> {
  const stripe = getStripeClient();
  const plan = getCheckoutPlan(request);
  const stripePriceId = getStripePriceId(plan);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (!user.email) {
    return {
      error: NextResponse.json(
        { error: 'A verified email address is required before starting checkout.' },
        { status: 400 },
      ),
    };
  }

  const admin = createSupabaseAdminClient();

  const { error: upsertError } = await admin.from('users').upsert(
    {
      email: user.email,
      id: user.id,
    },
    {
      onConflict: 'id',
    },
  );

  if (upsertError) {
    throw new Error(`Failed to initialize billing record: ${upsertError.message}`);
  }

  const { subscriptionStatus } = await getUserSubscriptionStatus();

  if (isSubscriptionActive(subscriptionStatus)) {
    return {
      error: NextResponse.json(
        { error: 'Subscription is already active for this account.' },
        { status: 409 },
      ),
    };
  }

  const { data: billingUser, error: billingUserError } = await admin
    .from('users')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle();

  if (billingUserError) {
    throw new Error(`Failed to load billing profile: ${billingUserError.message}`);
  }

  const appUrl = getAppUrl(new URL(request.url).origin);
  const session = await stripe.checkout.sessions.create({
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    cancel_url: `${appUrl}?checkout=cancelled`,
    client_reference_id: user.id,
    customer: billingUser?.stripe_customer_id ?? undefined,
    customer_email: billingUser?.stripe_customer_id ? undefined : user.email,
    line_items: [
      {
        price: stripePriceId,
        quantity: 1,
      },
    ],
    metadata: {
      billingPlan: plan,
      supabaseUserId: user.id,
    },
    mode: 'subscription',
    subscription_data: {
      metadata: {
        billingPlan: plan,
        supabaseUserId: user.id,
      },
    },
    success_url: `${appUrl}?checkout=success`,
  });

  if (!session.url) {
    throw new Error('Stripe checkout session was created without a redirect URL.');
  }

  return {
    url: session.url,
  };
}

async function createCheckoutResponse(request: Request, mode: 'json' | 'redirect') {
  try {
    const result = await buildCheckoutSession(request);

    if ('error' in result) {
      return result.error;
    }

    if (mode === 'redirect') {
      return NextResponse.redirect(result.url, { status: 303 });
    }

    return NextResponse.json({ url: result.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start checkout.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return createCheckoutResponse(request, 'redirect');
}

export async function POST(request: Request) {
  return createCheckoutResponse(request, 'json');
}