'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, UserPlus, AlertTriangle, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GminaSelect, type GminaOption, type GminaSelectValue } from '@/components/gmina/GminaSelect';
import { OrganizationSelect, type OrganizationOption } from '@/components/organization/OrganizationSelect';
import { copyToClipboard } from '@/lib/clipboard';

const ROLES = ['ADMIN', 'COORDINATOR', 'VOLUNTEER'] as const;

interface CreateInviteFormProps {
  gminas: GminaOption[];
  organizations: OrganizationOption[];
  isAdmin: boolean;
  currentUserOrganizationId: string | null;
  /** Display-only, for the "you're inviting into X" hint shown to a coordinator. */
  currentUserOrganizationName: string | null;
}

export function CreateInviteForm({
  gminas,
  organizations,
  isAdmin,
  currentUserOrganizationId,
  currentUserOrganizationName,
}: CreateInviteFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<typeof ROLES[number]>('VOLUNTEER');
  const [gmina, setGmina] = useState<GminaSelectValue>({ gminaId: null, newGminaName: null });
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const gminaRequired = isAdmin && role !== 'ADMIN';
  // Mirrors POST /api/admin/invites: an admin-issued invite now needs an
  // organization up front for any organization-scoped role, same as creating
  // a user directly does.
  const organizationRequired = isAdmin && role !== 'ADMIN';
  // A coordinator's invite always goes to their own organization — if they
  // don't have one assigned, they can't invite anyone at all.
  const blockedNoOrganization = !isAdmin && !currentUserOrganizationId;

  // Organization is itself gmina-scoped, so only offer ones belonging to the
  // gmina currently selected above — same pattern as UserFormModal.
  const organizationsInGmina = useMemo(
    () => (gmina.gminaId ? organizations.filter((o) => o.gminaId === gmina.gminaId) : []),
    [organizations, gmina.gminaId]
  );

  useEffect(() => {
    if (organizationId && !organizationsInGmina.some((o) => o.id === organizationId)) {
      setOrganizationId(null);
    }
  }, [organizationId, organizationsInGmina]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (blockedNoOrganization) return;
    setLoading(true);
    setMessage(null);
    setInviteUrl(null);
    setCopied(false);

    const body: Record<string, unknown> = { email, role: isAdmin ? role : 'VOLUNTEER' };
    if (isAdmin) {
      body.gminaId = gmina.gminaId || undefined;
      body.newGminaName = gmina.newGminaName || undefined;
      body.organizationId = organizationId || undefined;
    }

    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      setMessage(data.message ?? data.error ?? 'Coś poszło nie tak.');

      if (res.ok) {
        setEmail('');
        setOrganizationId(null);
        setInviteUrl(data.inviteUrl ?? null);
        setEmailConfigured(Boolean(data.emailConfigured));
        router.refresh();
      }
    } catch (err) {
      console.error('[CreateInviteForm] request failed:', err);
      setMessage('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!inviteUrl) return;
    const ok = await copyToClipboard(inviteUrl);
    if (ok) {
      setCopied(true);
    } else {
      setMessage('Nie udało się skopiować linku — zaznacz go ręcznie i skopiuj (Ctrl+C).');
    }
  }

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80">
      <div className="flex items-center gap-2 text-indigo-600 font-bold mb-4">
        <UserPlus className="h-5 w-5" />
        <h2 className="text-base font-extrabold text-slate-900">Nowe zaproszenie</h2>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5" htmlFor="email">
            Email zapraszanej osoby
          </label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 pl-10 pr-4 text-slate-900 placeholder-slate-400 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 text-sm transition"
            />
          </div>
        </div>
        {isAdmin && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5" htmlFor="role">
              Rola
            </label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof ROLES[number])}
              className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3.5 text-slate-900 font-semibold focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 text-sm transition"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        )}
        {isAdmin && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5" htmlFor="invite-gmina">
              Gmina{gminaRequired && ' *'}
            </label>
            <GminaSelect
              id="invite-gmina"
              gminas={gminas}
              value={gmina}
              onChange={setGmina}
              required={gminaRequired}
              newGminaMode="modal"
            />
          </div>
        )}
        {isAdmin && (
          <div>
            <label
              className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
              htmlFor="invite-organization"
            >
              Organizacja{organizationRequired && ' *'}
            </label>
            <OrganizationSelect
              id="invite-organization"
              organizations={organizationsInGmina}
              gminas={gminas}
              defaultGminaId={gmina.gminaId}
              value={organizationId}
              onChange={setOrganizationId}
              required={organizationRequired}
              disabled={role === 'ADMIN'}
            />
            {!gmina.gminaId && role !== 'ADMIN' && (
              <p className="text-[11px] text-slate-400 mt-1">Wybierz najpierw gminę, aby wybrać organizację.</p>
            )}
          </div>
        )}
        {!isAdmin && currentUserOrganizationName && (
          <div className="flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-indigo-800">
            <Building2 className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Zaproszenie trafi do Twojej organizacji: <strong>{currentUserOrganizationName}</strong>.
            </span>
          </div>
        )}
        {blockedNoOrganization && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Nie masz przypisanej organizacji — nie możesz zapraszać użytkowników. Skontaktuj się z administratorem.</span>
          </div>
        )}
        {message && <p className="text-xs text-slate-500">{message}</p>}
        <Button type="submit" disabled={loading || blockedNoOrganization} className="w-full">
          {loading ? 'Wysyłanie…' : 'Wyślij zaproszenie'}
        </Button>
        {inviteUrl && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] text-slate-500 mb-2">
              {emailConfigured
                ? 'E-mail z zaproszeniem został wysłany. Możesz też przekazać link ręcznie:'
                : 'Wiadomość e-mail nie jest jeszcze skonfigurowana — oto link zaproszenia do przekazania ręcznie:'}
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.target.select()}
                className="flex-1 rounded-xl bg-white border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 focus:outline-none"
              />
              <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
                {copied ? 'Skopiowano!' : 'Kopiuj'}
              </Button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
