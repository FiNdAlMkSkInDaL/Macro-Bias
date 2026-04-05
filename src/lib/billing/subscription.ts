import 'server-only';

import { createSupabaseAdminClient } from '../supabase/admin';
import { createSupabaseServerClient } from '../supabase/server';

const IGNORED_PROFILE_LOOKUP_ERROR_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);

function shouldIgnoreProfileLookupError(error: { code?: string }) {
  return error.code != null && IGNORED_PROFILE_LOOKUP_ERROR_CODES.has(error.code);
}

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'inactive'
  | null;

export type SubscriptionStatusResult = {
  isPro: boolean;
  user: {
    email: string | null | undefined;
    id: string;
  } | null;
  subscriptionStatus: SubscriptionStatus;
};

export function isSubscriptionActive(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'trialing';
}

async function getIsPro(userId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('is_pro')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    if (shouldIgnoreProfileLookupError(error)) {
      return false;
    }

    throw new Error(`Failed to read profiles.is_pro: ${error.message}`);
  }

  return data?.is_pro === true;
}

export async function getUserSubscriptionStatus(): Promise<SubscriptionStatusResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      isPro: false,
      user: null,
      subscriptionStatus: null,
    };
  }

  const { data, error } = await supabase
    .from('users')
    .select('subscription_status')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read subscription status: ${error.message}`);
  }

  const subscriptionStatus = (data?.subscription_status ?? 'inactive') as SubscriptionStatus;
  const profileIsPro = await getIsPro(user.id);
  const isPro = profileIsPro || isSubscriptionActive(subscriptionStatus);

  return {
    isPro,
    user: {
      email: user.email,
      id: user.id,
    },
    subscriptionStatus,
  };
}