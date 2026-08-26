'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';

export function AuthStatus() {
  const { data: session, status } = useSession();

  if (status === 'loading') return null;

  if (!session?.user) {
    return (
      <Link href="/login" className="hover:text-white transition-colors">
        Zaloguj się
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <span className="text-slate-400">
        {session.user.name ?? session.user.email}
        <span className="ml-1 text-xs uppercase text-slate-500">({session.user.role})</span>
      </span>
      <button
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="hover:text-white transition-colors"
      >
        Wyloguj się
      </button>
    </div>
  );
}
