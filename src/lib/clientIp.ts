/**
 * Azure App Service's front-end proxy appends exactly one trusted hop to
 * X-Forwarded-For (the client's real IP, as it reached Azure's edge) — so the
 * *last* entry is the one Azure itself observed. Everything before it is
 * client-supplied and can be freely spoofed to get a fresh "IP" per request,
 * bypassing the IP-based lockouts in ipLockout.ts/loginPairLockout.ts and the
 * per-IP rate limiters. Only meaningful behind exactly that one trusted hop —
 * revisit if the app ever sits behind an additional proxy/CDN.
 */
export function parseClientIp(xForwardedFor: string | null | undefined): string {
  if (!xForwardedFor) return 'unknown';
  const hops = xForwardedFor
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops[hops.length - 1] ?? 'unknown';
}
