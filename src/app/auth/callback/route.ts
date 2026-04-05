import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { getRequiredServerEnv } from '../../../lib/server-env';

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

export async function GET(request: NextRequest) {
  const redirectPath = sanitizeRedirectPath(
    request.nextUrl.searchParams.get('redirectTo') ?? request.nextUrl.searchParams.get('next'),
  );
  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const flowType = request.nextUrl.searchParams.get('type');
  const cookiesToApply: Array<{ name: string; value: string; options: CookieOptions }> = [];

  const supabase = createServerClient(
    getRequiredServerEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredServerEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          cookiesToApply.splice(0, cookiesToApply.length, ...cookiesToSet);
        },
      },
    },
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const successResponse = NextResponse.redirect(
        buildSuccessRedirect(request, redirectPath, flowType),
      );

      cookiesToApply.forEach(({ name, value, options }) => {
        successResponse.cookies.set(name, value, options);
      });

      return successResponse;
    }

    return NextResponse.redirect(
      buildErrorRedirect(request, redirectPath, error.message),
    );
  }

  if (tokenHash && flowType) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: flowType as EmailOtpType,
    });

    if (!error) {
      const successResponse = NextResponse.redirect(
        buildSuccessRedirect(request, redirectPath, flowType),
      );

      cookiesToApply.forEach(({ name, value, options }) => {
        successResponse.cookies.set(name, value, options);
      });

      return successResponse;
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