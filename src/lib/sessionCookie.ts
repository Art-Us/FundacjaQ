// Single source of truth for the session cookie name, shared by src/lib/auth.ts
// (Node runtime) and src/middleware.ts (Edge runtime). Deliberately dependency-free:
// middleware.ts cannot import from auth.ts directly, since auth.ts pulls in Prisma,
// ioredis, and bcrypt, none of which can bundle for the Edge runtime.
const isProd = process.env.NODE_ENV === 'production';

export const SESSION_COOKIE_NAME = isProd ? '__Host-next-auth.session-token' : 'next-auth.session-token';
