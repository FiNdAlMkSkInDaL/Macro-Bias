import 'server-only';

import { createSupabaseAdminClient } from '../supabase/admin';

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

export async function getStripeCustomerId(userId: string) {
  return (await getStripeCustomerIdFromProfiles(userId)) ?? (await getStripeCustomerIdFromUsers(userId));
}
