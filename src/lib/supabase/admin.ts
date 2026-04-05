import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { getRequiredServerEnv } from '../server-env';

export function createSupabaseAdminClient() {
  return createClient(
    getRequiredServerEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredServerEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}