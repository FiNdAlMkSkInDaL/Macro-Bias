import 'server-only';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { getRequiredServerEnv } from '../server-env';
import { RECOVERY_COOKIE, RECOVERY_GRANT_SECONDS, readRecoveryGrant, recoveryGrantMatchesUser } from './recovery-grant';

export const RECOVERY_INVALID_MESSAGE = 'That reset link is invalid or has expired. Request a new link.';
export const RECOVERY_SESSION_COOKIE = 'mb-password-recovery-session';

export class RecoveryTransportError extends Error {
  constructor(public readonly status: 429 | 503) {
    super(status === 429 ? 'Too many attempts. Please wait a few minutes, then try again.' : 'We could not check this reset link. Please try again shortly.');
  }
}

function checkAuthTransport(error: { name?: string; status?: number } | null) {
  if (error?.status === 429) throw new RecoveryTransportError(429);
  if (error && (error.name === 'AuthRetryableFetchError' || error.status === 0 || (error.status ?? 0) >= 500)) throw new RecoveryTransportError(503);
}

export function createRecoveryRouteClient(request: NextRequest) {
  const pendingCookies = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const supabase = createServerClient(
    getRequiredServerEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredServerEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      // Keep email verification and recovery sessions separate from ordinary
      // sign-in/signup cookies, including their browser-managed PKCE verifier.
      cookieOptions: { name: RECOVERY_SESSION_COOKIE, httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', maxAge: 3600 },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookies: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookies.forEach((cookie) => {
            request.cookies.set(cookie.name, cookie.value);
            // SSR's storage writer replaces the configured maxAge with its
            // 400-day default. Enforce the isolated recovery lifetime here.
            pendingCookies.set(cookie.name, { ...cookie, options: { ...cookie.options,
              httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:',
              maxAge: cookie.options.maxAge === 0 ? 0 : 3600,
            } });
          });
        },
      },
    },
  );

  function respond(response: NextResponse) {
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    return response;
  }

  return { supabase, respond };
}

export function setRecoveryCookie(response: NextResponse, request: NextRequest, value: string | null) {
  response.cookies.set(RECOVERY_COOKIE, value ?? '', {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: value ? RECOVERY_GRANT_SECONDS : 0,
  });
  return response;
}

export function clearRecoverySessionCookies(response: NextResponse, request: NextRequest) {
  request.cookies.getAll().forEach(({ name }) => {
    if (name === RECOVERY_SESSION_COOKIE || name.startsWith(`${RECOVERY_SESSION_COOKIE}.`) || name === `${RECOVERY_SESSION_COOKIE}-code-verifier`) {
      response.cookies.set(name, '', { path: '/', httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', maxAge: 0 });
    }
  });
  return response;
}

export async function getRecoveryAuthority(request: NextRequest, supabase: ReturnType<typeof createRecoveryRouteClient>['supabase']) {
  const grant = readRecoveryGrant(request.cookies.get(RECOVERY_COOKIE)?.value, request.nextUrl.origin);
  if (!grant) return null;

  // getSession is used only for the token fingerprint. Supabase getUser verifies
  // that exact token with the auth server before any recovery authority is used.
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  checkAuthTransport(sessionError);
  if (sessionError || !session?.access_token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(session.access_token);
  checkAuthTransport(error);
  if (error || !user || !recoveryGrantMatchesUser(grant, user, session.access_token)) return null;
  return { grant, user };
}
