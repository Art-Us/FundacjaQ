'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { AdminEventsBridge } from '@/components/AdminEventsBridge';
import { NewUserNotifier } from '@/components/NewUserNotifier';
import { ApiUnauthorizedRedirect } from '@/components/ApiUnauthorizedRedirect';

interface ProtectedShellProps {
  children: React.ReactNode;
  name: string;
  role: string;
  canManageInvites: boolean;
  canManageResources: boolean;
  canManageGminas: boolean;
  resourceInboxCount: number;
}

export function ProtectedShell({
  children,
  name,
  role,
  canManageInvites,
  canManageResources,
  canManageGminas,
  resourceInboxCount,
}: ProtectedShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Mounted here (not admin/layout.tsx) so it stays open across the WHOLE
  // app, not just while on an /admin/* page — that's what lets the sidebar's
  // "new user" dot and the corner toast fire even when an admin is looking
  // at, say, the alerts map. Gated to the roles that can ever act on these
  // events at all: a VOLUNTEER holding one open would be pure waste (the SSE
  // route itself would 403 them anyway — see api/admin/events/route.ts —
  // but there's no reason to make their browser even try).
  const canSeeAdminEvents = role === 'ADMIN' || role === 'COORDINATOR';

  return (
    <div className="min-h-screen bg-[#f4f7fb] flex">
      <ApiUnauthorizedRedirect />
      {canSeeAdminEvents && <AdminEventsBridge />}
      {role === 'ADMIN' && <NewUserNotifier />}
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
        canManageResources={canManageResources}
        canManageGminas={canManageGminas}
        resourceInboxCount={resourceInboxCount}
      />

      <div className="flex-1 flex flex-col min-w-0 lg:pl-64 transition-all duration-300">{children}</div>
    </div>
  );
}
