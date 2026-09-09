'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, UserPlus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GminaSelect, type GminaOption, type GminaSelectValue } from '@/components/gmina/GminaSelect';

const ROLES = ['ADMIN', 'COORDINATOR', 'VOLUNTEER'] as const;

interface CreateInviteFormProps {
  gminas: GminaOption[];
  isAdmin: boolean;
  currentUserGminaId: string | null;
}

export function CreateInviteForm({ gminas, isAdmin, currentUserGminaId }: CreateInviteFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<typeof ROLES[number]>('VOLUNTEER');
  const [gmina, setGmina] = useState<GminaSelectValue>({ gminaId: null, newGminaName: null });
  const [message, setMessage] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const gminaRequired = isAdmin && role !== 'ADMIN';
  // A coordinator's invite always goes to their own gmina — if they don't
  // have one assigned, they can't invite anyone at all.
  const blockedNoGmina = !isAdmin && !currentUserGminaId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (blockedNoGmina) return;
    setLoading(true);
    setMessage(null);
    setInviteUrl(null);
    setCopied(false);

    const body: Record<string, unknown> = { email, role: isAdmin ? role : 'VOLUNTEER' };
    if (isAdmin) {
      body.gminaId = gmina.gminaId || undefined;
      body.newGminaName = gmina.newGminaName || undefined;
    }

    const res = await fetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setLoading(false);
    setMessage(data.message ?? data.error ?? 'Coś poszło nie tak.');

    if (res.ok) {
      setEmail('');
      setInviteUrl(data.inviteUrl ?? null);
      setEmailConfigured(Boolean(data.emailConfigured));
      router.refresh();
    }
  }

  async function handleCopy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
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
            <GminaSelect id="invite-gmina" gminas={gminas} value={gmina} onChange={setGmina} required={gminaRequired} />
          </div>
        )}
        {blockedNoGmina && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Nie masz przypisanej gminy — nie możesz zapraszać użytkowników. Skontaktuj się z administratorem.</span>
          </div>
        )}
        {message && <p className="text-xs text-slate-500">{message}</p>}
        <Button type="submit" disabled={loading || blockedNoGmina} className="w-full">
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
