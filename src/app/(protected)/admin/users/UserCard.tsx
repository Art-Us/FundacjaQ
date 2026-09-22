'use client';

import { useState } from 'react';
import { Mail, Phone, Building2, MapPin, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleUserActiveButton } from '@/components/users/ToggleUserActiveButton';
import { UnlockUserButton } from '@/components/users/UnlockUserButton';
import type { OrganizationOption } from '@/components/organization/OrganizationSelect';
import { ROLE_LABELS } from '@/lib/users';
import { DeleteUserButton } from './DeleteUserButton';
import { UserFormModal } from './UserFormModal';
import type { UserGmina, UserListItem } from './types';

const ROLE_BADGE: Record<string, string> = {
  ADMIN: 'bg-purple-100 text-purple-800 border-purple-200',
  COORDINATOR: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  VOLUNTEER: 'bg-slate-100 text-slate-700 border-slate-200',
};

interface UserCardProps {
  user: UserListItem;
  isAdmin: boolean;
  /** Only a global admin (gminaId === null) may grant the ADMIN role — see PATCH /api/admin/users/[id]. */
  canGrantAdmin: boolean;
  /** Forwarded to the edit form's gmina picker — see GminaSelect's doc comment. */
  canCreateGmina: boolean;
  gminas: UserGmina[];
  organizations: OrganizationOption[];
  /** Called after any mutation (edit/activate/deactivate/delete) that should refresh the parent's currently-loaded page. */
  onChanged: () => void;
}

export function UserCard({ user, isAdmin, canGrantAdmin, canCreateGmina, gminas, organizations, onChanged }: UserCardProps) {
  const [showEdit, setShowEdit] = useState(false);
  const canDelete = isAdmin && !user.isSelf;
  const isLocked = !!user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now();

  return (
    <article className="rounded-3xl bg-white border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition flex flex-col justify-between gap-4">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 truncate">{user.name ?? user.email}</h3>
            <span
              className={`inline-block mt-1 text-[10px] uppercase font-bold px-2 py-0.5 rounded-lg border ${ROLE_BADGE[user.role]}`}
            >
              {ROLE_LABELS[user.role]}
            </span>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            {user.isActive ? (
              <span className="px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-700 text-[11px] font-bold border border-emerald-200">
                Aktywny
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-xl bg-rose-50 text-rose-700 text-[11px] font-bold border border-rose-200">
                Nieaktywny
              </span>
            )}
            {isLocked && (
              <span className="px-2.5 py-1 rounded-xl bg-amber-50 text-amber-700 text-[11px] font-bold border border-amber-200">
                Zablokowany
              </span>
            )}
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-1.5 text-xs text-slate-600">
          {user.organization && (
            <div className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{user.organization.name}</span>
            </div>
          )}
          {user.gmina && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{user.gmina.name}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200/60">
            <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{user.email}</span>
          </div>
          {user.phone && (
            <div className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{user.phone}</span>
            </div>
          )}
        </div>

        {((user.isActive && user.lastActivatedAt) || (!user.isActive && user.lastDeactivatedAt)) && (
          <p className="text-[11px] text-slate-400 leading-snug">
            {user.isActive
              ? `Aktywowano: ${user.lastActivatedAt}`
              : `Dezaktywowano: ${user.lastDeactivatedAt}${
                  user.deactivationReason ? ` — ${user.deactivationReason}` : ''
                }`}
          </p>
        )}
      </div>

      <div className="pt-2 flex flex-col gap-2 border-t border-slate-100">
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => setShowEdit(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edytuj
            </Button>
          )}
          {user.canManage && (
            <ToggleUserActiveButton userId={user.id} isActive={user.isActive} onSuccess={onChanged} />
          )}
          {user.canManage && isLocked && <UnlockUserButton userId={user.id} onSuccess={onChanged} />}
        </div>
        {canDelete && (
          <DeleteUserButton userId={user.id} userLabel={user.name ?? user.email} onSuccess={onChanged} />
        )}
      </div>

      {showEdit && (
        <UserFormModal
          mode="edit"
          user={user}
          gminas={gminas}
          organizations={organizations}
          canGrantAdmin={canGrantAdmin}
          canCreateGmina={canCreateGmina}
          onClose={() => setShowEdit(false)}
          onSaved={onChanged}
        />
      )}
    </article>
  );
}
