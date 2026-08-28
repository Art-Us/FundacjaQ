'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      render: (
        container: HTMLElement,
        params: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void }
      ) => number;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
const SCRIPT_SRC = 'https://www.google.com/recaptcha/api.js?render=explicit';

let scriptLoadPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (!scriptLoadPromise) {
    scriptLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Nie udało się załadować captchy.'));
      document.body.appendChild(script);
    });
  }
  return scriptLoadPromise;
}

/** Renders once a server response signals a captcha challenge is required. */
export function Captcha({ onToken }: { onToken: (token: string | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (!SITE_KEY) {
      console.warn('[captcha] NEXT_PUBLIC_RECAPTCHA_SITE_KEY not set — widget disabled.');
      return;
    }
    if (renderedRef.current) return;
    let cancelled = false;

    loadScript()
      .then(() => new Promise<void>((resolve) => window.grecaptcha!.ready(resolve)))
      .then(() => {
        if (cancelled || !containerRef.current || renderedRef.current) return;
        renderedRef.current = true;
        window.grecaptcha!.render(containerRef.current, {
          sitekey: SITE_KEY!,
          callback: onToken,
          'expired-callback': () => onToken(null),
        });
      })
      .catch((err) => console.error('[captcha]', err));

    return () => {
      cancelled = true;
    };
  }, [onToken]);

  if (!SITE_KEY) return null;

  return <div ref={containerRef} />;
}