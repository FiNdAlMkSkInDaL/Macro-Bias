import { NextResponse, type NextRequest } from 'next/server';

import { continuationFromSearchParams } from '@/lib/auth/continuation';
import { createRecoveryGrant, hasFreshRecoveryAuthentication } from '@/lib/auth/recovery-grant';
import { createRecoveryRouteClient, setRecoveryCookie } from '@/lib/auth/recovery-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { supabase, respond } = createRecoveryRouteClient(request);
  const resetUrl = new URL('/reset-password', request.nextUrl.origin);
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const code = request.nextUrl.searchParams.get('code');
  const redirectTo = continuationFromSearchParams({
    redirectTo: request.nextUrl.searchParams.get('redirectTo') ?? request.nextUrl.searchParams.get('next'),
    plan: request.nextUrl.searchParams.get('plan'),
    coupon: request.nextUrl.searchParams.get('coupon'),
  }) ?? '/dashboard';

  function invalidLink() {
    resetUrl.searchParams.set('error', 'invalid-link');
    resetUrl.searchParams.set('redirectTo', redirectTo);
    // An explicit empty fragment prevents a legacy implicit token fragment
    // from being inherited across the redirect into a rendered page.
    return setRecoveryCookie(respond(NextResponse.redirect(`${resetUrl.toString()}#`, 303)), request, null);
  }

  // The flow type is passed to Supabase itself. A query flag or PKCE storage
  // marker cannot turn a normal sign-in session into a recovery grant.
  if (
    (!code && (request.nextUrl.searchParams.get('type') !== 'recovery' || !tokenHash || !/^[A-Za-z0-9_-]{16,512}$/.test(tokenHash))) ||
    (code && (!/^[A-Za-z0-9_-]{16,1024}$/.test(code) || tokenHash))
  ) {
    return invalidLink();
  }

  try {
    const { data, error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: 'recovery' });
    if (error || !data.session?.access_token) return invalidLink();
    const { data: { user }, error: userError } = await supabase.auth.getUser(data.session.access_token);
    if (userError || !user?.updated_at || user.id !== data.session.user.id) return invalidLink();
    // PKCE recovery is proved by the auth server's signed authentication method,
    // not by type=recovery or the editable verifier-cookie suffix.
    if (code && !hasFreshRecoveryAuthentication(data.session.access_token)) return invalidLink();
    const grant = createRecoveryGrant({
      userId: user.id,
      userUpdatedAt: user.updated_at,
      accessToken: data.session.access_token,
      origin: request.nextUrl.origin,
      redirectTo,
    });
    return setRecoveryCookie(respond(NextResponse.redirect(`${resetUrl.toString()}#`, 303)), request, grant);
  } catch {
    return invalidLink();
  }
}
