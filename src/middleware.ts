import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { SESSION_COOKIE_NAME } from '@/lib/sessionCookie';

const PUBLIC_PATHS = ['/login', '/invite', '/forgot-password', '/reset-password', '/account-blocked'];

// Subset of PUBLIC_PATHS that only make sense for a signed-out visitor (sign in,
// accept an invite, request/perform a password reset). A signed-in user hitting
// one of these is bounced to '/' instead of being shown the form. /account-blocked
// is deliberately excluded — that page must stay reachable for a session the
// authoritative check has already invalidated (see the coarse-vs-live-check note
// below; this path-matching function can't tell the difference itself).
const AUTH_ONLY_PATHS = ['/login', '/invite', '/forgot-password', '/reset-password'];

function matchesPath(paths: string[], pathname: string): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isPublicPath(pathname: string): boolean {
  return matchesPath(PUBLIC_PATHS, pathname) || pathname.startsWith('/api/auth');
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    if (matchesPath(AUTH_ONLY_PATHS, pathname)) {
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, cookieName: SESSION_COOKIE_NAME });
      // Same coarse/stale token read as the authoritative gate below — good enough
      // here since the worst case (a just-deactivated account still reads as valid)
      // just bounces to '/', which the (protected) layout's live check then sends
      // on to /account-blocked anyway.
      if (token && !token.invalid) {
        return NextResponse.redirect(new URL('/', req.url));
      }
    }
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, cookieName: SESSION_COOKIE_NAME });

  // getToken() only decrypts the session cookie — it never runs authOptions.callbacks.jwt(),
  // so token.invalid/token.role here are a snapshot from sign-in time, not live DB state.
  // This is a coarse, fast gate for UX (bounce anonymous/expired-cookie visitors before any
  // rendering) and defense-in-depth for the /admin role check below; it is NOT where account
  // deactivation, password-change, or role-change revocation is enforced. That authoritative,
  // DB-backed check happens via getServerSession() in src/app/(protected)/layout.tsx, which
  // every protected page is under.
  if (!token || token.invalid) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith('/admin') && token.role !== 'ADMIN' && token.role !== 'COORDINATOR') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|manifest.json).*)'],
};
