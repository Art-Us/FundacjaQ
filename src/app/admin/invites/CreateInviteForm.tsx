'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

const ROLES = ['ADMIN', 'NGO', 'FIREFIGHTER', 'COORDINATOR', 'VOLUNTEER'] as const;

export function CreateInviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<typeof ROLES[number]>('VOLUNTEER');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

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
      router.refresh();
    }
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
    </form>
  );
}
