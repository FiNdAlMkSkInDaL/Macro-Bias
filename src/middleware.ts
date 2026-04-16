import { NextResponse, type NextRequest } from 'next/server';

import { updateSession } from './lib/supabase/middleware';

function isProtectedPath(pathname: string) {
  return (
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/analytics' ||
    pathname.startsWith('/analytics/')
  );
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

  if (!isProtectedPath(request.nextUrl.pathname) || user) {
    return response;
  }

  return NextResponse.redirect(buildRedirectUrl(request));
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};