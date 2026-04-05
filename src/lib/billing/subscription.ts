import 'server-only';

import { createSupabaseServerClient } from '../supabase/server';

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
  user: {
    email: string | null | undefined;
    id: string;
  } | null;
  subscriptionStatus: SubscriptionStatus;
};

export function isSubscriptionActive(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'trialing';
}

export async function getUserSubscriptionStatus(): Promise<SubscriptionStatusResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
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

  return {
    user: {
      email: user.email,
      id: user.id,
    },
    subscriptionStatus: (data?.subscription_status ?? 'inactive') as SubscriptionStatus,
  };
}