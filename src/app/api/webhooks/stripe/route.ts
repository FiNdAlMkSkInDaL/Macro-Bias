import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { getStripeClient, getStripeWebhookSecret } from '../../../../lib/stripe';

export const runtime = 'nodejs';

const ENTITLED_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing']);
const IGNORED_PROFILE_SYNC_ERROR_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);

type BillingSyncInput = {
  customerId: string | null;
  email: string | null;
  subscriptionId: string | null;
  subscriptionStatus: Stripe.Subscription.Status;
  userId: string | null;
};

function getStringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getMetadataUserId(metadata?: Stripe.Metadata | null) {
  if (!metadata) {
    return null;
  }

  return (
    getStringValue(metadata.supabaseUUID) ??
    getStringValue(metadata.supabaseUserId) ??
    getStringValue(metadata.supabase_uuid) ??
    getStringValue(metadata.supabase_user_id)
  );
}

function getCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined) {
  if (!customer) {
    return null;
  }

  return typeof customer === 'string' ? customer : customer.id;
}

function getSubscriptionId(subscription: string | Stripe.Subscription | null | undefined) {
  if (!subscription) {
    return null;
  }

  return typeof subscription === 'string' ? subscription : subscription.id;
}

function getInvoiceParentSubscriptionDetails(invoice: Stripe.Invoice) {
  const invoiceWithParent = invoice as Stripe.Invoice & {
    lines?: {
      data?: Array<{
        metadata?: Stripe.Metadata | null;
        parent?: {
          subscription_item_details?: {
            subscription?: string | Stripe.Subscription | null;
          } | null;
        } | null;
      }>;
    };
    parent?: {
      subscription_details?: {
        metadata?: Stripe.Metadata | null;
        subscription?: string | Stripe.Subscription | null;
      } | null;
    } | null;
    subscription?: string | Stripe.Subscription | null;
  };

  return invoiceWithParent;
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  const invoiceWithParent = getInvoiceParentSubscriptionDetails(invoice);

  return (
    getSubscriptionId(invoiceWithParent.subscription) ??
    getSubscriptionId(invoiceWithParent.parent?.subscription_details?.subscription) ??
    getSubscriptionId(
      invoiceWithParent.lines?.data?.find((lineItem) =>
        Boolean(lineItem.parent?.subscription_item_details?.subscription),
      )?.parent?.subscription_item_details?.subscription,
    )
  );
}

function getInvoiceMetadataUserId(invoice: Stripe.Invoice) {
  const invoiceWithParent = getInvoiceParentSubscriptionDetails(invoice);

  return (
    getMetadataUserId(invoice.metadata) ??
    getMetadataUserId(invoiceWithParent.parent?.subscription_details?.metadata) ??
    invoiceWithParent.lines?.data
      ?.map((lineItem) => getMetadataUserId(lineItem.metadata))
      .find((userId): userId is string => Boolean(userId)) ??
    null
  );
}

function isEntitledStatus(status: Stripe.Subscription.Status) {
  return ENTITLED_STATUSES.has(status);
}

function shouldIgnoreProfileSyncError(error: { code?: string; message: string }) {
  return error.code != null && IGNORED_PROFILE_SYNC_ERROR_CODES.has(error.code);
}

async function getStripeCustomerEmail(customerId: string | null) {
  if (!customerId) {
    return null;
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.retrieve(customerId);

  if ('deleted' in customer && customer.deleted) {
    return null;
  }

  return customer.email ?? null;
}

async function findUserIdByField(
  column: 'email' | 'stripe_customer_id' | 'stripe_subscription_id',
  value: string | null,
) {
  if (!value) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from('users').select('id').eq(column, value).maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve billing user by ${column}: ${error.message}`);
  }

  return data?.id ?? null;
}

async function getSupabaseUserEmail(userId: string | null) {
  if (!userId) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);

  if (error) {
    throw new Error(`Failed to load Supabase user ${userId}: ${error.message}`);
  }

  return data.user?.email ?? null;
}

async function resolveBillingUserId({ customerId, email, subscriptionId, userId }: BillingSyncInput) {
  if (userId) {
    return userId;
  }

  return (
    (await findUserIdByField('stripe_customer_id', customerId)) ??
    (await findUserIdByField('stripe_subscription_id', subscriptionId)) ??
    (await findUserIdByField('email', email))
  );
}

async function syncLegacyProfileEntitlement(userId: string, isPro: boolean) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('profiles').update({ is_pro: isPro }).eq('id', userId);

  if (error && !shouldIgnoreProfileSyncError(error)) {
    throw new Error(`Failed to update profiles.is_pro: ${error.message}`);
  }
}

async function syncBillingAccess(input: BillingSyncInput) {
  const resolvedUserId = await resolveBillingUserId(input);

  if (!resolvedUserId) {
    throw new Error(
      'Unable to match the Stripe customer to a Supabase user via metadata, customer ID, subscription ID, or email.',
    );
  }

  const admin = createSupabaseAdminClient();
  const email = input.email ?? (await getSupabaseUserEmail(resolvedUserId));
  const { error } = await admin.from('users').upsert(
    {
      email,
      id: resolvedUserId,
      stripe_customer_id: input.customerId,
      stripe_subscription_id: input.subscriptionId,
      subscription_status: input.subscriptionStatus,
    },
    {
      onConflict: 'id',
    },
  );

  if (error) {
    throw new Error(`Failed to update subscription status: ${error.message}`);
  }

  await syncLegacyProfileEntitlement(resolvedUserId, isEntitledStatus(input.subscriptionStatus));
}

async function buildCheckoutSessionSyncInput(session: Stripe.Checkout.Session): Promise<BillingSyncInput> {
  const subscriptionId = getSubscriptionId(session.subscription);
  const customerId = getCustomerId(session.customer);
  const stripe = getStripeClient();
  const subscription = subscriptionId
    ? await stripe.subscriptions.retrieve(subscriptionId)
    : null;

  return {
    customerId,
    email:
      session.customer_details?.email ??
      session.customer_email ??
      (await getStripeCustomerEmail(customerId)),
    subscriptionId,
    subscriptionStatus: subscription?.status ?? 'active',
    userId:
      getMetadataUserId(session.metadata) ??
      getMetadataUserId(subscription?.metadata) ??
      getStringValue(session.client_reference_id),
  };
}

async function buildInvoiceSyncInput(invoice: Stripe.Invoice): Promise<BillingSyncInput> {
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  const customerId = getCustomerId(invoice.customer);
  const stripe = getStripeClient();
  const subscription = subscriptionId
    ? await stripe.subscriptions.retrieve(subscriptionId)
    : null;

  return {
    customerId,
    email: invoice.customer_email ?? (await getStripeCustomerEmail(customerId)),
    subscriptionId,
    subscriptionStatus: 'active',
    userId: getInvoiceMetadataUserId(invoice) ?? getMetadataUserId(subscription?.metadata),
  };
}

async function buildSubscriptionSyncInput(
  subscription: Stripe.Subscription,
): Promise<BillingSyncInput> {
  const customerId = getCustomerId(subscription.customer);

  return {
    customerId,
    email: await getStripeCustomerEmail(customerId),
    subscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    userId: getMetadataUserId(subscription.metadata),
  };
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
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await syncBillingAccess(await buildCheckoutSessionSyncInput(session));
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await syncBillingAccess(await buildInvoiceSyncInput(invoice));
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await syncBillingAccess(await buildSubscriptionSyncInput(subscription));
        break;
      }
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}