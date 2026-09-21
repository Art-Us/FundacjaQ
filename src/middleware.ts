import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { SESSION_COOKIE_NAME } from '@/lib/sessionCookie';

const isProd = process.env.NODE_ENV === 'production';

// Nonce-based script-src (instead of 'unsafe-inline') so Next's own hydration/
// RSC bootstrap scripts still run: Next reads the nonce back off the
// 'Content-Security-Policy' *request* header (set below) and stamps it onto
// the inline <script> tags it emits while rendering.
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://www.google.com https://www.gstatic.com` +
      (isProd ? '' : " 'unsafe-eval' 'unsafe-inline'"),
    "style-src 'self' 'unsafe-inline'",
    // *.tile.openstreetmap.org serwuje kafelki mapy (Leaflet, strona /map) —
    // bez tego przeglądarka po cichu blokuje obrazki tła mapy przez CSP, bez
    // widocznego błędu sieciowego (tylko wpis o naruszeniu CSP w konsoli).
    "img-src 'self' data: https://*.tile.openstreetmap.org",
    "font-src 'self'",
    "connect-src 'self' https://www.google.com",
    "frame-src https://www.google.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

function nextWithCsp(req: NextRequest, nonce: string, csp: string) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

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
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

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
    return nextWithCsp(req, nonce, csp);
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
    // An API caller expects JSON back, not an HTML page — a redirect here
    // would send fetch() transparently following it to the /login page (200,
    // HTML), and the caller's res.json() would then throw on the markup
    // instead of surfacing "you're signed out" the way a real 401 does.
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Defense-in-depth, not the authoritative check: every /api/admin/* route
  // already calls requireAdmin()/requireAdminOrCoordinator() itself (a live,
  // DB-backed check — see authz.ts), which is what actually enforces the
  // ADMIN-vs-COORDINATOR distinction per route. This coarse gate exists so a
  // route that someday forgets that call still fails closed here instead of
  // being wide open, the same way the /admin page check below already
  // protects pages. It can only ever be as strict as the loosest real admin
  // API route (ADMIN or COORDINATOR), never route-specific.
  const isAdminPath = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');
  if (isAdminPath && token.role !== 'ADMIN' && token.role !== 'COORDINATOR') {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/', req.url));
  }

  return nextWithCsp(req, nonce, csp);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|manifest.json).*)'],
};
