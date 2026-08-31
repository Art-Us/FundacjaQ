import { cache } from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';

// For React Server Components only (pages/layouts) — NOT for Route Handlers.
// getServerSession() re-hits the DB on every call (authOptions.callbacks.jwt() runs a
// prisma.user.findUnique). React's cache() memoizes it per request, so a layout and its
// page calling this within the same render pass share one DB round trip instead of each
// paying for their own. Route Handlers don't have this problem (they're a single call
// site per request already) and importing `react`'s cache() there would drag a
// React-Server-Components-only API into plain request handlers for no benefit — see
// src/lib/authz.ts, which calls getServerSession() directly for that reason.
export const getSession = cache(() => getServerSession(authOptions));
