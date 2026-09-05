'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Hasła nie są identyczne.');
      return;
    }

    setLoading(true);
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    setSuccess(true);
    setTimeout(() => router.push('/login'), 1500);
  }

  if (success) {
    return (
      <div className="rounded-2xl bg-emerald-50 p-4 border border-emerald-200 text-center space-y-2">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto" />
        <p className="text-xs font-semibold text-emerald-800">Hasło zmienione. Przekierowywanie do logowania…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5" htmlFor="password">
          Nowe hasło
        </label>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="password"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl bg-slate-50 border border-slate-200 py-3 pl-10 pr-4 text-slate-900 placeholder-slate-400 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 text-sm transition"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5" htmlFor="confirmPassword">
          Powtórz hasło
        </label>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="confirmPassword"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-xl bg-slate-50 border border-slate-200 py-3 pl-10 pr-4 text-slate-900 placeholder-slate-400 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 text-sm transition"
          />
        </div>
      </div>
      {error && (
        <div className="flex items-start gap-2 rounded-2xl bg-red-50 p-3 border border-red-200 text-red-700 text-xs font-medium">
          {error}
        </div>
      )}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? 'Zapisywanie…' : 'Ustaw nowe hasło'}
      </Button>
    </form>
  );
}
