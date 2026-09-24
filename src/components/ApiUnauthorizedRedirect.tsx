'use client';

import { useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { isProtectedApiPath } from '@/lib/apiUnauthorized';
import { closeAllSseConnections } from '@/lib/sseClientRegistry';

/**
 * Mounted once in ProtectedShell, so every fetch() call anywhere in the app
 * is covered without threading a wrapper through each of the 20+ call sites
 * that call the admin/resources/alerts APIs directly. middleware.ts answers
 * a missing/invalid session cookie on a protected /api/* route with a JSON
 * 401 (see middleware.ts) rather than redirecting the fetch itself — this is
 * what actually acts on that 401: signs out client-side (clearing the now-
 * stale cookie) and sends the user to /login, instead of leaving them
 * looking at whatever inline "Unauthorized" error the calling component
 * happens to render.
 */
export function ApiUnauthorizedRedirect() {
  useEffect(() => {
    const originalFetch = window.fetch;
    let redirecting = false;

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);

      if (response.status === 401 && !redirecting) {
        const input = args[0];
        const url = input instanceof Request ? input.url : String(input);
        const { pathname } = new URL(url, window.location.origin);
        if (isProtectedApiPath(pathname)) {
          redirecting = true;
          // See sseClientRegistry.ts's doc comment — must run BEFORE
          // signOut()'s own navigation, or that navigation's new connection
          // can stall behind these still-open ones.
          closeAllSseConnections();
          // signOut() makes its own network call (POST /api/auth/signout)
          // which can itself fail — left unguarded, that would leave
          // `redirecting` wedged true forever (silently swallowing every
          // later 401 in this mount) with the user stuck looking at a stale
          // authenticated UI and no path back to /login short of a manual
          // reload. Forcing a hard redirect on failure guarantees they still
          // get there even if the sign-out call itself couldn't complete.
          signOut({ callbackUrl: '/login' }).catch((err) => {
            console.error('[ApiUnauthorizedRedirect] signOut failed, forcing a hard redirect:', err);
            window.location.href = '/login';
          });
        }
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
