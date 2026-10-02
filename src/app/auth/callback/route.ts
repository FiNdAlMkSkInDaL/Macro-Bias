import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { continuationFromSearchParams } from '../../../lib/auth/continuation';
import { createRecoveryGrant, hasFreshRecoveryAuthentication } from '../../../lib/auth/recovery-grant';
import { createRecoveryRouteClient, setRecoveryCookie } from '../../../lib/auth/recovery-server';
import { getRequiredServerEnv } from '../../../lib/server-env';
import { GET as handleRecovery } from '../recovery/route';

type PendingCookie = { name: string; value: string; options: CookieOptions };

function errorRedirect(request: NextRequest, redirectPath: string) {
  const url = new URL('/login', request.nextUrl.origin);
  url.searchParams.set('redirectTo', redirectPath);
  url.searchParams.set('authError', 'That sign-in link is invalid or has expired. Please sign in or request a new link.');
  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('type') === 'recovery') return handleRecovery(request);
  const redirectPath = continuationFromSearchParams({
    redirectTo: request.nextUrl.searchParams.get('redirectTo') ?? request.nextUrl.searchParams.get('next'),
    plan: request.nextUrl.searchParams.get('plan'),
    coupon: request.nextUrl.searchParams.get('coupon'),
  }) ?? '/';
  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const flowType = request.nextUrl.searchParams.get('type');
  const cookiesToApply = new Map<string, PendingCookie>();
  const supabase = createServerClient(
    getRequiredServerEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredServerEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookies.forEach((cookie) => { request.cookies.set(cookie.name, cookie.value); cookiesToApply.set(cookie.name, cookie); });
      },
    } },
  );

  async function success(session?: { access_token: string; refresh_token: string } | null) {
    if (session?.access_token && session.refresh_token) {
      const { error } = await supabase.auth.setSession(session);
      if (error) return errorRedirect(request, redirectPath);
    }
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return errorRedirect(request, redirectPath);

    // Legacy PKCE recovery links also enter the isolated HttpOnly reset session.
    // A caller-supplied flag or verifier suffix cannot prove this auth method.
    if (code && session?.access_token && user.updated_at && hasFreshRecoveryAuthentication(session.access_token)) {
      const recovery = createRecoveryRouteClient(request);
      const { data, error: recoveryError } = await recovery.supabase.auth.setSession(session);
      if (recoveryError || !data.session?.access_token) return errorRedirect(request, redirectPath);
      const grant = createRecoveryGrant({ userId: user.id, userUpdatedAt: user.updated_at,
        accessToken: data.session.access_token, origin: request.nextUrl.origin, redirectTo: redirectPath });
      const response = recovery.respond(NextResponse.redirect(new URL('/reset-password#', request.nextUrl.origin), 303));
      return setRecoveryCookie(response, request, grant);
    }

    const response = NextResponse.redirect(new URL(redirectPath, request.nextUrl.origin));
    cookiesToApply.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }

  try {
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      return error ? errorRedirect(request, redirectPath) : await success(data.session);
    }
    const allowedTypes = new Set(['signup', 'invite', 'magiclink', 'email_change', 'email']);
    if (tokenHash && flowType && allowedTypes.has(flowType)) {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: flowType as EmailOtpType });
      return error ? errorRedirect(request, redirectPath) : await success(data.session);
    }
    return errorRedirect(request, redirectPath);
  } catch {
    return errorRedirect(request, redirectPath);
  }
}