'use client';

import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { Captcha } from '@/components/ui/Captcha';
import { useCaptchaGate } from '@/hooks/useCaptchaGate';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const captcha = useCaptchaGate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Captured before the request: only reset the captcha (widget + token)
    // if a token was actually part of this submission — otherwise there's
    // nothing stale to clear.
    const hadCaptchaToken = captcha.token !== null;

    const result = await signIn('credentials', {
      email,
      password,
      captchaToken: captcha.token ?? undefined,
      redirect: false,
    });

    setLoading(false);

    if (result?.error === 'CAPTCHA_REQUIRED') {
      captcha.require();
      setError('Zbyt wiele prób. Potwierdź, że nie jesteś robotem.');
      return;
    }

    if (result?.error) {
      setError(result.error);
      if (hadCaptchaToken) captcha.reset();
      return;
    }

    router.push(searchParams.get('callbackUrl') ?? '/');
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5" htmlFor="email">
          Email
        </label>
        <div className="relative">
          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl bg-slate-50 border border-slate-200 py-3 pl-10 pr-4 text-slate-900 placeholder-slate-400 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 text-sm transition"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5" htmlFor="password">
          Hasło
        </label>
        <PasswordInput
          id="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {captcha.required && <Captcha ref={captcha.ref} onToken={captcha.setToken} />}
      {error && (
        <div className="flex items-start gap-2 rounded-2xl bg-red-50 p-3 border border-red-200 text-red-700 text-xs font-medium">
          {error}
        </div>
      )}
      <Button type="submit" disabled={loading || captcha.disabled} className="w-full">
        {loading ? 'Logowanie…' : 'Zaloguj się'}
      </Button>
      <a href="/forgot-password" className="text-xs text-slate-500 hover:text-indigo-600 text-center transition-colors">
        Nie pamiętasz hasła?
      </a>
    </form>
  );
}