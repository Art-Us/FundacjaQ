import type { DefaultSession, DefaultUser } from 'next-auth';
import type { DefaultJWT } from 'next-auth/jwt';

declare module 'next-auth' {
  interface User extends DefaultUser {
    role: string;
    gminaId: string | null;
  }

  interface Session extends DefaultSession {
    user?: {
      id: string;
      role: string;
      gminaId: string | null;
    } & DefaultSession['user'];
    // Set (with user undefined) when a live session was invalidated specifically
    // because the account was deactivated, as opposed to a stale password or a
    // temporary lockout — lets the UI show a "contact an admin" page instead of
    // a plain session-expired redirect.
    blocked?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    role?: string;
    gminaId?: string | null;
    invalid?: boolean;
    invalidReason?: 'deactivated' | 'stale';
  }
}
