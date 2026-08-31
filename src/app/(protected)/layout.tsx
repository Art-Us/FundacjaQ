import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

// The authoritative session check for every non-public page. Unlike middleware.ts
// (which only decrypts the cookie), getSession() runs authOptions.callbacks.jwt()
// against the current DB state, so a deactivated account, a changed password, or an
// active lockout kills access here immediately, even mid-session. Any page nested
// under this route group gets that guarantee without having to remember to check itself.
//
// getSession() is React-cache()'d, so pages under this layout that need the session's
// data (role, gminaId, ...) should also call getSession() rather than getServerSession()
// directly — within one request they share this single DB round trip instead of each
// paying for their own.
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user) {
    redirect('/login');
  }

  return <>{children}</>;
}
