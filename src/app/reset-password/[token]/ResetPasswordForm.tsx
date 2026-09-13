'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/PasswordInput';

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
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'Coś poszło nie tak.');
        return;
      }

      setSuccess(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch (err) {
      console.error('[ResetPasswordForm] request failed:', err);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
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
        <PasswordInput
          id="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5" htmlFor="confirmPassword">
          Powtórz hasło
        </label>
        <PasswordInput
          id="confirmPassword"
          required
          minLength={12}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
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
