import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { getRequiredServerEnv } from '../../../lib/server-env';

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

function sanitizeRedirectPath(rawRedirectPath: string | null): string {
  if (!rawRedirectPath || !rawRedirectPath.startsWith('/') || rawRedirectPath.startsWith('//')) {
    return '/dashboard';
  }

  return rawRedirectPath;
}

function buildErrorRedirect(request: NextRequest, redirectPath: string, message: string) {
  const errorRedirectUrl = request.nextUrl.clone();

  errorRedirectUrl.pathname = '/';
  errorRedirectUrl.search = '';
  errorRedirectUrl.searchParams.set('redirectTo', redirectPath);
  errorRedirectUrl.searchParams.set('authError', message);

  return errorRedirectUrl;
}

function buildSuccessRedirect(request: NextRequest, redirectPath: string, flowType: string | null) {
  const successRedirectUrl = new URL(redirectPath, request.nextUrl.origin);

  if (flowType === 'recovery') {
    successRedirectUrl.searchParams.set('authFlow', 'recovery');
  }

  return successRedirectUrl;
}

function applyPendingCookies(
  response: NextResponse,
  cookiesToApply: Map<string, PendingCookie>,
) {
  cookiesToApply.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  return response;
}

export async function GET(request: NextRequest) {
  const redirectPath = sanitizeRedirectPath(
    request.nextUrl.searchParams.get('redirectTo') ?? request.nextUrl.searchParams.get('next'),
  );
  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const flowType = request.nextUrl.searchParams.get('type');
  const cookiesToApply = new Map<string, PendingCookie>();

  const supabase = createServerClient(
    getRequiredServerEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredServerEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            cookiesToApply.set(name, { name, value, options });
          });
        },
      },
    },
  );

  async function buildAuthenticatedSuccessResponse(session?: {
    access_token: string;
    refresh_token: string;
  } | null) {
    if (session?.access_token && session.refresh_token) {
      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });

      if (setSessionError) {
        return NextResponse.redirect(
          buildErrorRedirect(request, redirectPath, setSessionError.message),
        );
      }
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.redirect(
        buildErrorRedirect(
          request,
          redirectPath,
          userError?.message ??
            'We could not finish signing you in automatically. Please open the verification link again.',
        ),
      );
    }

    return applyPendingCookies(
      NextResponse.redirect(buildSuccessRedirect(request, redirectPath, flowType)),
      cookiesToApply,
    );
  }

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return buildAuthenticatedSuccessResponse(data.session);
    }

    return NextResponse.redirect(
      buildErrorRedirect(request, redirectPath, error.message),
    );
  }

  if (tokenHash && flowType) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: flowType as EmailOtpType,
    });

    if (!error) {
      return buildAuthenticatedSuccessResponse(data.session);
    }

    return NextResponse.redirect(
      buildErrorRedirect(request, redirectPath, error.message),
    );
  }

  return NextResponse.redirect(
    buildErrorRedirect(
      request,
      redirectPath,
      'That authentication link is missing the required verification parameters.',
    ),
  );
}