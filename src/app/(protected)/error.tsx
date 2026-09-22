'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

// Segment-level boundary for every signed-in page. Without one, a single throw
// anywhere below (most often Leaflet's "Map container is already initialized",
// an upstream react-leaflet 4.2.1 lifecycle bug on /map and /alerty/[alertId])
// unmounts the whole React tree and the user is left staring at a blank app
// with no way back. Here the sidebar/shell from layout.tsx stays up, the
// message is readable, and reset() re-renders the segment onto a fresh DOM
// subtree — which is exactly what a re-initialised map container needs.
export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[protected] unhandled error:', error);
  }, [error]);

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-3xl w-full mx-auto">
      <div className="rounded-3xl bg-white p-6 shadow-xs border border-rose-200 space-y-4">
        <div className="flex items-center gap-2 text-rose-700">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <h1 className="text-base font-extrabold">Coś poszło nie tak</h1>
        </div>

        <p className="text-sm text-slate-600">
          Ta część aplikacji przestała odpowiadać. Pozostałe sekcje działają normalnie — możesz
          spróbować ponownie albo wrócić do nich w menu po lewej.
        </p>

        <pre className="rounded-2xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 whitespace-pre-wrap break-words">
          {error.message || 'Nieznany błąd.'}
        </pre>

        {/* Server-side throws reach the client with the message scrubbed; the
            digest is the only handle that ties this screen to the full stack
            trace in the server log. */}
        {error.digest && (
          <p className="text-[11px] font-mono text-slate-400">digest: {error.digest}</p>
        )}

        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Spróbuj ponownie
        </button>
      </div>
    </main>
  );
}
