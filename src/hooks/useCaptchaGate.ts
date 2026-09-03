'use client';

import { useRef, useState } from 'react';
import type { CaptchaHandle } from '@/components/ui/Captcha';

/**
 * Shared client-side state for the server's step-up captcha gate (login,
 * forgot-password, invite-accept all trigger it the same way): whether the
 * widget should render, its current token, and resetting both together —
 * a reCAPTCHA token is single-use server-side, so a widget left "solved"
 * after a failed attempt would just resubmit an already-consumed token.
 */
export function useCaptchaGate() {
  const [required, setRequired] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const ref = useRef<CaptchaHandle>(null);

  function reset() {
    setToken(null);
    ref.current?.reset();
  }

  /** Call when a response first signals the captcha challenge turned on. */
  function require() {
    setRequired(true);
    reset();
  }

  return { required, token, setToken, ref, reset, require, disabled: required && !token };
}
