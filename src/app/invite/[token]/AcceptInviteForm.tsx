'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { acceptInvite } from './actions';

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await acceptInvite(token, password, confirmPassword);
    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? 'Coś poszło nie tak.');
      return;
    }

    setSuccess(true);
    setTimeout(() => router.push('/login'), 1500);
  }

  if (success) {
    return <p className="text-sm text-emerald-400">Konto utworzone. Przekierowywanie do logowania…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full max-w-sm">
      <div>
        <label className="block text-sm text-slate-400 mb-1" htmlFor="password">
          Hasło
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1" htmlFor="confirmPassword">
          Powtórz hasło
        </label>
        <input
          id="confirmPassword"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>
      {error && <p className="text-sm text-rose-500">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? 'Tworzenie konta…' : 'Utwórz konto'}
      </Button>
    </form>
  );
}
