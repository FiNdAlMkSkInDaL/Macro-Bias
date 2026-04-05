import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { getStripeClient, getStripeWebhookSecret } from '../../../../lib/stripe';

export const runtime = 'nodejs';

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const stripe = getStripeClient();
  const userId = session.metadata?.supabaseUserId ?? session.client_reference_id;

  if (!userId) {
    throw new Error('Checkout session is missing the Supabase user identifier.');
  }

  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id ?? null;
  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;

  let subscriptionStatus: string = 'active';

  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    subscriptionStatus = subscription.status;
  }

  const admin = createSupabaseAdminClient();
  let email = session.customer_details?.email ?? session.customer_email ?? null;

  if (!email) {
    const { data } = await admin.auth.admin.getUserById(userId);
    email = data.user?.email ?? null;
  }

  const { error } = await admin.from('users').upsert(
    {
      email,
      id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      subscription_status: subscriptionStatus,
    },
    {
      onConflict: 'id',
    },
  );

  if (error) {
    throw new Error(`Failed to update subscription status: ${error.message}`);
  }
}

export async function POST(request: Request) {
  const stripe = getStripeClient();
  const stripeWebhookSecret = getStripeWebhookSecret();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature header.' }, { status: 400 });
  }

  const payload = await request.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, stripeWebhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid Stripe webhook payload.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}