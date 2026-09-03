'use client';

import React, { useState } from 'react';
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

    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, captchaToken: captcha.token ?? undefined }),
    });
    const data = await res.json();
    setLoading(false);

    if (data.captchaRequired) {
      captcha.require();
    } else if (hadCaptchaToken) {
      captcha.reset();
    }

    setMessage(data.message ?? data.error ?? 'Coś poszło nie tak.');
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
      {captcha.required && <Captcha ref={captcha.ref} onToken={captcha.setToken} />}
      {message && <p className="text-sm text-slate-300">{message}</p>}
      <Button type="submit" disabled={loading || captcha.disabled} className="w-full">
        {loading ? 'Wysyłanie…' : 'Wyślij link resetujący'}
      </Button>
    </form>
  );
}