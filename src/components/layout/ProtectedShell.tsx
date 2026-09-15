'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';

interface ProtectedShellProps {
  children: React.ReactNode;
  name: string;
  role: string;
  canManageInvites: boolean;
}

export function ProtectedShell({ children, name, role, canManageInvites }: ProtectedShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f4f7fb] flex">
      <button
        type="button"
        onClick={() => setIsSidebarOpen(true)}
        className="fixed top-4 left-4 z-40 p-2.5 rounded-2xl bg-white/90 backdrop-blur-md shadow-md border border-slate-200/80 text-slate-700 hover:text-indigo-600 lg:hidden transition"
        title="Otwórz menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <Sidebar
        isOpen={isSidebarOpen}
        onCloseMobile={() => setIsSidebarOpen(false)}
        name={name}
        role={role}
        canManageInvites={canManageInvites}
      />

      <div className="flex-1 flex flex-col min-w-0 lg:pl-64 transition-all duration-300">{children}</div>
    </div>
  );
}
