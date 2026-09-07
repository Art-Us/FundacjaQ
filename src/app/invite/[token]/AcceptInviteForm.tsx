'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { Captcha } from '@/components/ui/Captcha';
import { useCaptchaGate } from '@/hooks/useCaptchaGate';
import { acceptInvite } from './actions';

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const captcha = useCaptchaGate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Captured before the request: a failure after a token was already
    // consumed still needs a reset even when this response's own
    // `captchaRequired` flag is false (e.g. password rejected post-captcha).
    const wasRequired = captcha.required;

    const result = await acceptInvite(token, password, confirmPassword, captcha.token ?? undefined);
    setLoading(false);

    if (result.captchaRequired) {
      captcha.require();
    }

    if (!result.ok) {
      setError(result.error ?? 'Coś poszło nie tak.');
      if (wasRequired) captcha.reset();
      return;
    }

    setSuccess(true);
    setTimeout(() => router.push('/login'), 1500);
  }

  if (success) {
    return (
      <div className="rounded-2xl bg-emerald-50 p-4 border border-emerald-200 text-center space-y-2">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto" />
        <p className="text-xs font-semibold text-emerald-800">Konto utworzone. Przekierowywanie do logowania…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5" htmlFor="password">
          Hasło
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
      {captcha.required && <Captcha ref={captcha.ref} onToken={captcha.setToken} />}
      {error && (
        <div className="flex items-start gap-2 rounded-2xl bg-red-50 p-3 border border-red-200 text-red-700 text-xs font-medium">
          {error}
        </div>
      )}
      <Button type="submit" disabled={loading || captcha.disabled} className="w-full">
        {loading ? 'Tworzenie konta…' : 'Utwórz konto'}
      </Button>
    </form>
  );
}