import { NextResponse, type NextRequest } from 'next/server';

import { continuationFromSearchParams } from '@/lib/auth/continuation';
import { sendRecoveryEmail } from '@/lib/auth/recovery-email';
import { clearRecoverySessionCookies, createRecoveryRouteClient, getRecoveryAuthority, RECOVERY_INVALID_MESSAGE, RecoveryTransportError, setRecoveryCookie } from '@/lib/auth/recovery-server';

export const dynamic = 'force-dynamic';

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: {
    'Cache-Control': 'no-store, max-age=0',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  } });
}

function hasSameOrigin(request: NextRequest) {
  return request.headers.get('origin') === request.nextUrl.origin;
}

async function readPayload(request: NextRequest): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return null;
  const body = await request.text();
  if (body.length > 8192) return null;
  try {
    const payload: unknown = JSON.parse(body);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return json({ error: 'Please request a reset from this site.' }, 403);
  const payload = await readPayload(request);
  const email = typeof payload?.email === 'string' ? payload.email.trim() : '';
  if (!email || email.length > 254 || email.split('@')[0].length > 64 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Enter a valid email address.' }, 400);
  }
  const redirectTo = continuationFromSearchParams({
    redirectTo: typeof payload?.redirectTo === 'string' ? payload.redirectTo : null,
  }) ?? '/dashboard';
  const recoveryUrl = new URL('/auth/recovery', request.nextUrl.origin);
  recoveryUrl.searchParams.set('redirectTo', redirectTo);

  try {
    if (process.env.RESEND_API_KEY) {
      const delivery = await sendRecoveryEmail(request, email, redirectTo);
      return delivery.ok ? json({ ok: true }) : json({ error: delivery.error }, delivery.status);
    }
    // Native SSR PKCE preserves Supabase's recovery delivery and rate limiting.
    // The initiating browser receives an HttpOnly verifier cookie. Custom
    // token-hash email templates also work when opened in a different browser.
    const { supabase, respond } = createRecoveryRouteClient(request);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: recoveryUrl.toString() });
    if (error) {
      if (error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit') {
        return json({ error: 'Too many reset requests. Please wait a few minutes, then try again.' }, 429);
      }
      return json({ error: 'We could not send a reset link right now. Please try again shortly.' }, 503);
    }
    return respond(json({ ok: true }));
  } catch {
    return json({ error: 'We could not send a reset link right now. Check your connection and try again.' }, 503);
  }
}

export async function GET(request: NextRequest) {
  const { supabase, respond } = createRecoveryRouteClient(request);
  try {
    const authority = await getRecoveryAuthority(request, supabase);
    if (!authority) return setRecoveryCookie(respond(json({ canReset: false, error: RECOVERY_INVALID_MESSAGE })), request, null);
    return respond(json({ canReset: true, redirectTo: authority.grant.redirectTo }));
  } catch (error) {
    return respond(json({ canReset: false, error: error instanceof RecoveryTransportError ? error.message : 'We could not check this reset link. Please try again shortly.' }, error instanceof RecoveryTransportError ? error.status : 503));
  }
}

export async function PUT(request: NextRequest) {
  if (!hasSameOrigin(request)) return json({ error: 'Please update your password from this site.' }, 403);
  const { supabase, respond } = createRecoveryRouteClient(request);
  try {
    const authority = await getRecoveryAuthority(request, supabase);
    if (!authority) return setRecoveryCookie(respond(json({ error: RECOVERY_INVALID_MESSAGE }, 401)), request, null);
    const payload = await readPayload(request);
    const password = typeof payload?.password === 'string' ? payload.password : '';
    if (password.length < 8 || password.length > 1024) return respond(json({ error: 'Use a password with at least 8 characters.' }, 400));
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (error.status === 429 || error.code === 'over_request_rate_limit') return respond(json({ error: 'Too many attempts. Please wait a few minutes, then try again.' }, 429));
      if (error.code === 'same_password') return respond(json({ error: 'Choose a password different from your current password.' }, 400));
      if (error.code === 'weak_password') return respond(json({ error: 'Choose a stronger password with a mix of letters, numbers and symbols.' }, 400));
      if (error.status === 401 || error.status === 403) return setRecoveryCookie(respond(json({ error: RECOVERY_INVALID_MESSAGE }, 401)), request, null);
      return respond(json({ error: 'We could not update your password. Please try again shortly.' }, 503));
    }

    // Password completion invalidates copied grants. Revoke the recovery
    // session, and clear its browser state even if revocation has a network
    // failure after the password was already successfully updated.
    try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* Browser recovery state is cleared below. */ }
    return clearRecoverySessionCookies(setRecoveryCookie(respond(json({ ok: true, redirectTo: authority.grant.redirectTo })), request, null), request);
  } catch (error) {
    return respond(json({ error: error instanceof RecoveryTransportError ? error.message : 'We could not update your password. Check your connection and try again.' }, error instanceof RecoveryTransportError ? error.status : 503));
  }
}
