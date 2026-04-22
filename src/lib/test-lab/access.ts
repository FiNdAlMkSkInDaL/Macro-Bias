import 'server-only';

import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';

import { isTestLabAllowedEmail } from './constants';

export async function requireTestLabAccess() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/');
  }

  if (!isTestLabAllowedEmail(user.email)) {
    redirect('/');
  }

  return user;
}
