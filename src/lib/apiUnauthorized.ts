/**
 * True for any protected JSON API route whose 401 should trigger a
 * client-side sign-out and redirect to /login — every /api/* route except
 * /api/auth itself (NextAuth's own endpoints, which must never trigger this
 * — see middleware.ts's isPublicPath, which carves out the same exception).
 */
export function isProtectedApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/') && !pathname.startsWith('/api/auth');
}
