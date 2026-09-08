'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';

export function NavLinks() {
  const { data: session, status } = useSession();

  if (status === 'loading' || !session?.user) return null;

  return (
    <>
      <Link href="/" className="hover:text-white transition-colors">
        Strona główna
      </Link>
      <Link href="/map" className="hover:text-white transition-colors">
        Mapa
      </Link>
    </>
  );
}
