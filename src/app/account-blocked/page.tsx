'use client';

import { useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';

export default function AccountBlockedPage() {
  // The redirect here happens because the live session check already found the
  // account deactivated (src/app/(protected)/layout.tsx), but the session cookie
  // itself is still sitting in the browser until something clears it. Do that as
  // soon as this page mounts so the user is actually signed out, not just looking
  // at a page while still holding a technically-active cookie.
  useEffect(() => {
    signOut({ redirect: false });
  }, []);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-slate-100 mb-4">Konto zostało zablokowane</h1>
      <p className="text-slate-400 max-w-md mb-8">
        Twoje konto zostało dezaktywowane. Skontaktuj się z administratorem, aby przywrócić dostęp.
      </p>
      <Button onClick={() => signOut({ callbackUrl: '/login' })}>Przejdź do logowania</Button>
    </main>
  );
}
