import React from 'react';
import Link from 'next/link';

export const Navbar = () => {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
            Q
          </div>
          <span className="font-extrabold text-slate-100 text-lg tracking-tight">QFundation</span>
        </Link>

        <nav className="flex items-center gap-6 text-sm font-medium text-slate-300">
          <Link href="/" className="hover:text-white transition-colors">
            Strona główna
          </Link>
        </nav>
      </div>
    </header>
  );
};
