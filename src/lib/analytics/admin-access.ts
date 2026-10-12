import 'server-only';

import { cache } from 'react';
import { ANALYTICS_INTERNAL_EMAILS } from '@/lib/analytics/traffic-policy';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Preserve the existing owner and include the account explicitly requested by
// the owner. Billing or a manual Pro flag never grants analytics permission.
export const ANALYTICS_ADMIN_EMAILS = new Set<string>(ANALYTICS_INTERNAL_EMAILS);

export const getAnalyticsAdminUser = cache(async () => {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user?.email_confirmed_at || !user.email || !ANALYTICS_ADMIN_EMAILS.has(user.email.trim().toLowerCase())) return null;
    return user;
  } catch { return null; }
});
