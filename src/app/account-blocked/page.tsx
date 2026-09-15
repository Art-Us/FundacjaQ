'use client';

import { useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { ShieldAlert } from 'lucide-react';
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
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm border border-slate-200/80">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 mb-4 shadow-xs">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Konto zostało zablokowane</h1>
        <p className="text-xs text-slate-500 mb-6">
          Twoje konto zostało dezaktywowane. Skontaktuj się z administratorem, aby przywrócić dostęp.
        </p>
        <Button onClick={() => signOut({ callbackUrl: '/login' })} className="w-full">
          Przejdź do logowania
        </Button>
      </div>
    </main>
  );
}
