'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

const ROLES = ['ADMIN', 'COORDINATOR', 'VOLUNTEER'] as const;

export function CreateInviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<typeof ROLES[number]>('VOLUNTEER');
  const [message, setMessage] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setInviteUrl(null);
    setCopied(false);

    const res = await fetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    const data = await res.json();
    setLoading(false);
    setMessage(data.message ?? data.error ?? 'Coś poszło nie tak.');

    if (res.ok) {
      setEmail('');
      setInviteUrl(data.inviteUrl ?? null);
      router.refresh();
    }
  }

  async function handleCopy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full max-w-sm">
      <div>
        <label className="block text-sm text-slate-400 mb-1" htmlFor="email">
          Email zapraszanej osoby
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1" htmlFor="role">
          Rola
        </label>
        <select
          id="role"
          value={role}
          onChange={(e) => setRole(e.target.value as typeof ROLES[number])}
          className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      {message && <p className="text-sm text-slate-300">{message}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? 'Wysyłanie…' : 'Wyślij zaproszenie'}
      </Button>
      {inviteUrl && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
          <p className="text-xs text-slate-500 mb-2">
            Wiadomość e-mail nie jest jeszcze skonfigurowana — oto link zaproszenia do przekazania ręcznie:
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={inviteUrl}
              onFocus={(e) => e.target.select()}
              className="flex-1 rounded-md bg-slate-950 border border-slate-800 px-2 py-1.5 text-xs text-slate-300 focus:outline-none"
            />
            <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
              {copied ? 'Skopiowano!' : 'Kopiuj'}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
