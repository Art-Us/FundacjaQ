const isProd = process.env.NODE_ENV === 'production';

// Content-Security-Policy is set per-request in src/middleware.ts instead (it
// needs a fresh nonce per response for script-src to work without 'unsafe-inline').
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
    // Next 14 otherwise re-serves a dynamic page from the client router
    // cache for 30s on in-app navigation — e.g. clicking "Mapa" in the
    // sidebar right after someone else added an alert would still show the
    // old list. Every page here is session-dependent and dynamic anyway.
    staleTimes: {
      dynamic: 0,
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;