import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export async function partitionUnlockedSubscribers(
  supabase: SupabaseClient,
  freeEmails: readonly string[],
): Promise<{ unlockedEmails: string[]; regularFreeEmails: string[] }> {
  if (freeEmails.length === 0) {
    return { unlockedEmails: [], regularFreeEmails: [] };
  }

  const { data, error } = await supabase
    .from('free_subscribers')
    .select('email, premium_unlock_expires_at')
    .in('email', [...freeEmails])
    .not('premium_unlock_expires_at', 'is', null)
    .gt('premium_unlock_expires_at', new Date().toISOString());

  if (error) {
    console.error('[premium-unlock] Failed to load unlocked subscribers', error);
    return {
      unlockedEmails: [],
      regularFreeEmails: [...freeEmails],
    };
  }

  const unlockedSet = new Set(data?.map((r: { email: string }) => r.email) ?? []);

  return {
    unlockedEmails: freeEmails.filter((e) => unlockedSet.has(e)),
    regularFreeEmails: freeEmails.filter((e) => !unlockedSet.has(e)),
  };
}
