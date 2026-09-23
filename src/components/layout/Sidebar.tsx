'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Home, UserPlus, Users, MapPin, Building2, History, LogOut, ChevronRight, Package } from 'lucide-react';
import { useHasNewUser } from '@/hooks/useHasNewUser';
import { closeAllSseConnections } from '@/lib/sseClientRegistry';
import { ProfileModal } from './ProfileModal';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  COORDINATOR: 'Koordynator gminny',
  VOLUNTEER: 'Wolontariusz',
};

interface SidebarProps {
  isOpen: boolean;
  onCloseMobile: () => void;
  name: string;
  role: string;
  canManageInvites: boolean;
  canManageResources: boolean;
  canManageGminas: boolean;
  resourceInboxCount: number;
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
  return initials || 'U';
}

export function Sidebar({
  isOpen,
  onCloseMobile,
  name,
  role,
  canManageInvites,
  canManageResources,
  canManageGminas,
  resourceInboxCount,
}: SidebarProps) {
  const pathname = usePathname();
  const hasNewUser = useHasNewUser();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  // Sidebar's `name` prop comes from the server-rendered session (see
  // layout.tsx/ProtectedShell.tsx) and won't reflect a self-edit until the
  // next sign-in refreshes the JWT (see auth.ts's jwt callback — it only
  // re-syncs role/gminaId/organizationId/isActive on each check, not
  // name/email). This local override lets the sidebar show the new name
  // immediately after ProfileModal saves, without waiting for that.
  const [displayName, setDisplayName] = useState(name);
  useEffect(() => setDisplayName(name), [name]);

  const linkClasses = (active: boolean) =>
    `group flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
      active
        ? 'bg-indigo-50 text-indigo-700 shadow-sm border border-indigo-100 font-bold'
        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
    }`;

  return (
    <>
      {isOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden transition-opacity"
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-white border-r border-slate-200/80 shadow-sm flex flex-col justify-between transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col flex-1 min-h-0">
          <div className="h-16 flex items-center px-6 border-b border-slate-100 gap-3 shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white font-bold shadow-md shadow-indigo-500/25">
              Q
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-base tracking-tight text-slate-900">ResQ</span>
              <span className="text-[10px] font-medium text-slate-400">Aplikacja FundationQ</span>
            </div>
          </div>

          <div className="p-4 space-y-6 overflow-y-auto flex-1">
            <div className="space-y-1">
              <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Główne</div>
              <Link href="/" onClick={onCloseMobile} className={linkClasses(pathname === '/')}>
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:text-indigo-600 group-hover:bg-indigo-50 transition">
                    <Home className="h-4 w-4" />
                  </div>
                  <span>Strona główna</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
              <Link href="/map" onClick={onCloseMobile} className={linkClasses(pathname === '/map')}>
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:text-indigo-600 group-hover:bg-indigo-50 transition">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <span>Mapa</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
              {/* ADMIN/COORDINATOR only (розділ 4, docs/are-you-familiar-with-tidy-blum.md)
                  — hiding this for VOLUNTEER is a UI convenience, not the real
                  access control; that's the server-side redirect in
                  zasoby/page.tsx (Крок 31). */}
              {canManageResources && (
                <Link href="/zasoby" onClick={onCloseMobile} className={linkClasses(pathname === '/zasoby')}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:text-indigo-600 group-hover:bg-indigo-50 transition">
                      <Package className="h-4 w-4" />
                    </div>
                    <span>Zasoby</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {resourceInboxCount > 0 && (
                      <span className="min-w-[1.25rem] px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold text-center leading-none">
                        {resourceInboxCount}
                      </span>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              )}
            </div>

            {canManageInvites && (
              <div className="space-y-1">
                <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Administracja</div>
                <Link href="/admin/invites" onClick={onCloseMobile} className={linkClasses(pathname === '/admin/invites')}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100 transition">
                      <UserPlus className="h-4 w-4" />
                    </div>
                    <span>Zaproszenia</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
                <Link href="/admin/users" onClick={onCloseMobile} className={linkClasses(pathname === '/admin/users')}>
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100 transition">
                      <Users className="h-4 w-4" />
                      {/* New pending account since this was last visited — see
                          lib/newUserNotice.ts. ADMIN-only, same as the toast
                          that fires alongside it (components/NewUserNotifier.tsx). */}
                      {role === 'ADMIN' && hasNewUser && (
                        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />
                      )}
                    </div>
                    <span>Użytkownicy</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
                {canManageGminas && (
                  <Link href="/admin/gminas" onClick={onCloseMobile} className={linkClasses(pathname === '/admin/gminas')}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100 transition">
                        <MapPin className="h-4 w-4" />
                      </div>
                      <span>Gminy</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                )}
                {role === 'ADMIN' && (
                  <Link
                    href="/admin/organizations"
                    onClick={onCloseMobile}
                    className={linkClasses(pathname === '/admin/organizations')}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100 transition">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <span>Organizacje</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                )}
                {role === 'ADMIN' && (
                  <Link href="/admin/logs" onClick={onCloseMobile} className={linkClasses(pathname === '/admin/logs')}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100 transition">
                        <History className="h-4 w-4" />
                      </div>
                      <span>Dziennik zdarzeń</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="p-3 border-t border-slate-100 bg-slate-50/70 shrink-0">
          <div className="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-white border border-slate-200/80 shadow-xs">
            <button
              type="button"
              onClick={() => setIsProfileOpen(true)}
              className="flex items-center gap-2.5 min-w-0 rounded-xl -m-0.5 p-0.5 hover:bg-slate-50 transition text-left"
              title="Zarządzaj swoim kontem"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white font-bold text-xs shadow-xs">
                {getInitials(displayName)}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-slate-800 truncate leading-tight">{displayName}</span>
                <span className="text-[10px] font-semibold text-indigo-600 uppercase truncate">
                  {ROLE_LABELS[role] ?? role}
                </span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                // See sseClientRegistry.ts's doc comment — must run BEFORE
                // signOut()'s own navigation, or that navigation's new
                // connection can stall behind these still-open ones.
                closeAllSseConnections();
                signOut({ callbackUrl: '/login' });
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition shrink-0"
              title="Wyloguj się"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {isProfileOpen && (
        <ProfileModal
          onClose={() => setIsProfileOpen(false)}
          onSaved={(user) => setDisplayName(user.name ?? displayName)}
        />
      )}
    </>
  );
}
