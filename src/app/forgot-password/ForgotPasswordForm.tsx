'use client';

import React, { useState } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Captcha } from '@/components/ui/Captcha';
import { useCaptchaGate } from '@/hooks/useCaptchaGate';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const captcha = useCaptchaGate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    // Captured before the request: a submitted token is single-use at
    // Google regardless of outcome, so it must be reset even after a
    // *successful* verification — this form stays mounted, so a resubmit
    // (e.g. a retyped email) could otherwise resend an already-spent token.
    const hadCaptchaToken = captcha.token !== null;

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, captchaToken: captcha.token ?? undefined }),
      });
      const data = await res.json().catch(() => ({}));

      if (data.captchaRequired) {
        captcha.require();
      } else if (hadCaptchaToken) {
        captcha.reset();
      }

      setMessage(data.message ?? data.error ?? 'Coś poszło nie tak.');
    } catch (err) {
      console.error('[ForgotPasswordForm] request failed:', err);
      setMessage('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
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
      {captcha.required && <Captcha ref={captcha.ref} onToken={captcha.setToken} />}
      {message && <p className="text-xs text-slate-500">{message}</p>}
      <Button type="submit" disabled={loading || captcha.disabled} className="w-full">
        {loading ? 'Wysyłanie…' : 'Wyślij link resetujący'}
      </Button>
    </form>
  );
}