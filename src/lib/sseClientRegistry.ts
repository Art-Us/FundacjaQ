'use client';

// Tracks every open EventSource this tab holds (AppEventsBridge,
// AdminEventsBridge) so signOut() can force them all closed FIRST.
//
// Root cause this exists for: an HTTP/1.1 origin has a small
// per-origin connection cap (6 in Chromium), and each open SSE stream pins
// one of those sockets for its entire (unbounded) lifetime — our server-side
// heartbeat (see api/events/route.ts) keeps it alive on purpose, it's never
// meant to close on its own. next-auth's signOut() does a fetch (POST
// /api/auth/signout) and then a hard navigation to /login — and a React
// effect cleanup (source.close() in the bridges) is NOT guaranteed to run
// before that navigation's own connection attempt starts (it fires on
// unmount, which a `window.location` navigation doesn't wait for). With both
// bridges' sockets still held open, that new connection can end up queued
// behind them for the browser's own per-origin cap — measured at the
// low-tens-of-seconds before the OS/browser finally reclaims a socket, while
// the SERVER itself stays fully responsive the entire time (a plain curl to
// the same origin in parallel returns instantly) — this is a client-side
// connection-starvation deadlock, not a server slowdown. Closing every
// tracked EventSource synchronously before signOut() is called frees those
// sockets immediately, so the post-signout navigation never has to wait.
const sources = new Set<EventSource>();

export function registerSseConnection(source: EventSource): () => void {
  sources.add(source);
  return () => {
    sources.delete(source);
  };
}

export function closeAllSseConnections(): void {
  sources.forEach((source) => source.close());
  sources.clear();
}
