'use client';

import { useEffect } from 'react';

// Last resort: only reaches the screen when the failure is in the root layout
// itself, which is above every other boundary. It replaces that layout, so it
// has to ship its own <html>/<body> and cannot rely on globals.css, the font,
// or SessionProvider being applied — hence the inline styles.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global] unhandled error:', error);
  }, [error]);

  return (
    <html lang="pl">
      <body style={{ margin: 0, padding: '2rem', background: '#f4f7fb', fontFamily: 'system-ui, sans-serif', color: '#1e293b' }}>
        <div style={{ maxWidth: '40rem', margin: '0 auto', background: '#fff', border: '1px solid #fecdd3', borderRadius: '1.5rem', padding: '1.5rem' }}>
          <h1 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: '#be123c' }}>Aplikacja napotkała krytyczny błąd</h1>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#475569' }}>
            Odśwież stronę. Jeśli błąd się powtarza, przekaż poniższy identyfikator administratorowi.
          </p>
          <pre style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '1rem', padding: '0.75rem', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {error.message || 'Nieznany błąd.'}
          </pre>
          {error.digest && (
            <p style={{ fontSize: '0.6875rem', fontFamily: 'monospace', color: '#94a3b8' }}>digest: {error.digest}</p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: '0.5rem', padding: '0.5rem 1rem', borderRadius: '0.75rem', border: 'none', background: '#4f46e5', color: '#fff', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
          >
            Spróbuj ponownie
          </button>
        </div>
      </body>
    </html>
  );
}
