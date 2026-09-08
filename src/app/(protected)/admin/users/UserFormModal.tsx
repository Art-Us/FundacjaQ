'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/PasswordInput';
import type { UserGmina, UserListItem, UserRole } from './types';

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'VOLUNTEER', label: 'Wolontariusz' },
  { value: 'COORDINATOR', label: 'Koordynator' },
  { value: 'ADMIN', label: 'Administrator' },
];

const inputClasses =
  'w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3.5 text-sm text-slate-900 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition';
const labelClasses = 'block text-xs font-bold text-slate-600 mb-1.5';

interface UserFormModalProps {
  mode: 'create' | 'edit';
  user?: UserListItem;
  gminas: UserGmina[];
  onClose: () => void;
}

export function UserFormModal({ mode, user, gminas, onClose }: UserFormModalProps) {
  const router = useRouter();
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(user?.name ?? '');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'VOLUNTEER');
  const [organization, setOrganization] = useState(user?.organization ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [gminaId, setGminaId] = useState(user?.gmina?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            organization: organization || undefined,
            phone: phone || undefined,
            gminaId: gminaId || undefined,
          }
        : {
            email,
            role,
            name: name || null,
            organization: organization || null,
            phone: phone || null,
            gminaId: gminaId || null,
          };

    const res = await fetch(mode === 'create' ? '/api/admin/users' : `/api/admin/users/${user!.id}`, {
      method: mode === 'create' ? 'POST' : 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    router.refresh();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-form-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-xl space-y-5">
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
                Gmina
              </label>
              <select
                id="user-gmina"
                value={gminaId}
                onChange={(e) => setGminaId(e.target.value)}
                className={inputClasses}
              >
                <option value="">— Brak —</option>
                {gminas.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="user-organization" className={labelClasses}>
              Organizacja
            </label>
            <input
              id="user-organization"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              className={inputClasses}
            />
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
  );
}
