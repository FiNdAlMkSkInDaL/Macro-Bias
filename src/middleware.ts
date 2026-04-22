import { NextResponse, type NextRequest } from 'next/server';

import { updateSession } from './lib/supabase/middleware';
import { isTestLabAllowedEmail } from './lib/test-lab/constants';

function isProtectedPath(pathname: string) {
  return (
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/analytics' ||
    pathname.startsWith('/analytics/') ||
    pathname === '/test' ||
    pathname.startsWith('/test/')
  );
}

function isTestLabPath(pathname: string) {
  return pathname === '/test' || pathname.startsWith('/test/');
}

function buildRedirectUrl(request: NextRequest) {
  const redirectUrl = request.nextUrl.clone();
  const redirectPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  redirectUrl.pathname = '/';
  redirectUrl.searchParams.set('redirectTo', redirectPath);

  return redirectUrl;
}

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);

  if (!isProtectedPath(request.nextUrl.pathname)) {
    return response;
  }

  if (!user) {
    return NextResponse.redirect(buildRedirectUrl(request));
  }

  if (isTestLabPath(request.nextUrl.pathname) && !isTestLabAllowedEmail(user.email)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
