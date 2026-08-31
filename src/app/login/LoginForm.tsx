'use client';

import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Captcha } from '@/components/ui/Captcha';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn('credentials', {
      email,
      password,
      captchaToken: captchaToken ?? undefined,
      redirect: false,
    });

    setLoading(false);

    if (result?.error === 'CAPTCHA_REQUIRED') {
      setCaptchaRequired(true);
      setError('Zbyt wiele prób. Potwierdź, że nie jesteś robotem.');
      return;
    }

    if (result?.error) {
      setError(result.error);
      return;
    }

    router.push(searchParams.get('callbackUrl') ?? '/');
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full max-w-sm">
      <div>
        <label className="block text-sm text-slate-400 mb-1" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1" htmlFor="password">
          Hasło
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>
      {captchaRequired && <Captcha onToken={setCaptchaToken} />}
      {error && <p className="text-sm text-rose-500">{error}</p>}
      <Button type="submit" disabled={loading || (captchaRequired && !captchaToken)} className="w-full">
        {loading ? 'Logowanie…' : 'Zaloguj się'}
      </Button>
      <a href="/forgot-password" className="text-sm text-slate-400 hover:text-white text-center">
        Nie pamiętasz hasła?
      </a>
    </form>
  );
}