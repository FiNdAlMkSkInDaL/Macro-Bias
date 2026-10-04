import { createClient } from '@supabase/supabase-js';

import { getRequiredServerEnv } from '../server-env';

export function createSupabaseAdminClient(options: { timeoutMs?: number } = {}) {
  return createClient(
    getRequiredServerEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredServerEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      ...(options.timeoutMs ? { global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const deadline = AbortSignal.timeout(Math.max(1, Math.floor(options.timeoutMs!)));
          return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
        },
      } } : {}),
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
