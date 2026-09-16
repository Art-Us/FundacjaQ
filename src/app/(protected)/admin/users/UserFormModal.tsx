'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { GminaSelect, type GminaSelectValue } from '@/components/gmina/GminaSelect';
import { OrganizationSelect, type OrganizationOption } from '@/components/organization/OrganizationSelect';
import { ROLE_LABELS } from '@/lib/users';
import type { UserGmina, UserListItem, UserRole } from './types';

const ROLES: { value: UserRole; label: string }[] = (['VOLUNTEER', 'COORDINATOR', 'ADMIN'] as const).map((value) => ({
  value,
  label: ROLE_LABELS[value],
}));

const inputClasses =
  'w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3.5 text-sm text-slate-900 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition';
const labelClasses = 'block text-xs font-bold text-slate-600 mb-1.5';

interface UserFormModalProps {
  mode: 'create' | 'edit';
  user?: UserListItem;
  gminas: UserGmina[];
  organizations: OrganizationOption[];
  onClose: () => void;
  /** Called after a successful create/edit, before onClose — lets the caller refetch its own list instead of relying on router.refresh(). */
  onSaved?: () => void;
}

export function UserFormModal({ mode, user, gminas, organizations, onClose, onSaved }: UserFormModalProps) {
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(user?.name ?? '');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'VOLUNTEER');
  const [organizationId, setOrganizationId] = useState<string | null>(user?.organization?.id ?? null);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [gmina, setGmina] = useState<GminaSelectValue>({ gminaId: user?.gmina?.id ?? null, newGminaName: null });
  const gminaRequired = mode === 'create' && role !== 'ADMIN';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Organization is itself gmina-scoped (see schema.prisma), so only offer
  // organizations belonging to the gmina currently selected above — the
  // server rejects a mismatch anyway (POST/PATCH /api/admin/users), but
  // surfacing only valid options here means an admin can't even pick a bad
  // combination in the first place, instead of hitting that error on submit.
  const organizationsInGmina = useMemo(
    () => (gmina.gminaId ? organizations.filter((o) => o.gminaId === gmina.gminaId) : []),
    [organizations, gmina.gminaId]
  );

  // If the gmina changes (or is cleared) after an organization was already
  // picked, that organization may no longer be one of the valid options
  // above — clear the stale selection rather than leave a value selected
  // that no longer appears in the dropdown's own option list.
  useEffect(() => {
    if (organizationId && !organizationsInGmina.some((o) => o.id === organizationId)) {
      setOrganizationId(null);
    }
  }, [organizationId, organizationsInGmina]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const body =
      mode === 'create'
        ? {
            email,
            password,
            role,
            name: name || undefined,
            organizationId: organizationId || undefined,
            phone: phone || undefined,
            gminaId: gmina.gminaId || undefined,
            newGminaName: gmina.newGminaName || undefined,
          }
        : {
            email,
            role,
            name: name || null,
            organizationId: organizationId || null,
            phone: phone || null,
            gminaId: gmina.newGminaName ? null : gmina.gminaId,
            newGminaName: gmina.newGminaName || undefined,
          };

    try {
      const res = await fetch(mode === 'create' ? '/api/admin/users' : `/api/admin/users/${user!.id}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'Coś poszło nie tak.');
        return;
      }

      onSaved?.();
      onClose();
    } catch (err) {
      console.error('[UserFormModal] request failed:', err);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }

  // Rendered via a portal into document.body — a modal nested deep in the page
  // tree is still visually "fixed", but keeping it there is one more ancestor
  // that a future style change (transform/filter/contain) could turn into a
  // containing block for it, breaking full-viewport coverage. A portal makes
  // it the last child of <body> so it always paints above the rest of the page.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-form-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg max-h-[90vh] rounded-3xl bg-white shadow-xl overflow-hidden flex flex-col">
        <div className="modal-scrollbar min-h-0 overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 id="user-form-modal-title" className="text-lg font-bold text-slate-900">
            {mode === 'create' ? 'Nowy użytkownik' : 'Edytuj użytkownika'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            aria-label="Zamknij"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="user-email" className={labelClasses}>
              Email
            </label>
            <input
              id="user-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClasses}
            />
          </div>

          {mode === 'create' && (
            <div>
              <label htmlFor="user-password" className={labelClasses}>
                Hasło tymczasowe
              </label>
              <PasswordInput
                id="user-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Co najmniej 12 znaków. Konto zostanie utworzone jako nieaktywne — aktywujesz je osobno po utworzeniu.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="user-name" className={labelClasses}>
              Imię i nazwisko
            </label>
            <input id="user-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClasses} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="user-role" className={labelClasses}>
                Rola
              </label>
              <select
                id="user-role"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className={inputClasses}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="user-gmina" className={labelClasses}>
                Gmina{gminaRequired && ' *'}
              </label>
              <GminaSelect
              id="user-gmina"
              gminas={gminas}
              value={gmina}
              onChange={setGmina}
              required={gminaRequired}
              newGminaMode="modal"
            />
            </div>
          </div>

          <div>
            <label htmlFor="user-organization" className={labelClasses}>
              Organizacja
            </label>
            <OrganizationSelect
              id="user-organization"
              organizations={organizationsInGmina}
              gminas={gminas}
              defaultGminaId={gmina.gminaId}
              value={organizationId}
              onChange={setOrganizationId}
            />
            {!gmina.gminaId && (
              <p className="text-[11px] text-slate-400 mt-1">Wybierz najpierw gminę, aby wybrać organizację.</p>
            )}
          </div>

          <div>
            <label htmlFor="user-phone" className={labelClasses}>
              Telefon
            </label>
            <input id="user-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClasses} />
          </div>

          {error && <p className="text-xs text-rose-500">{error}</p>}

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" variant="primary" className="flex-1" disabled={loading}>
              {loading ? 'Zapisywanie…' : mode === 'create' ? 'Utwórz konto' : 'Zapisz zmiany'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
              Anuluj
            </Button>
          </div>
        </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
