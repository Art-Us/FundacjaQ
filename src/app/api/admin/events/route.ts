import type { NextRequest } from 'next/server';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { subscribeToAdminEvents } from '@/lib/adminEvents';
import { acquireSseSlot, releaseSseSlot, touchSseSlot } from '@/lib/sseConnectionLimit';

export const runtime = 'nodejs';

// Keeps the connection alive through a reverse proxy's idle-connection
// timeout (Azure App Service's front end included) — without a steady trickle
// of bytes, a long-idle SSE stream gets silently dropped and the browser has
// to notice and reconnect instead of just staying open.
const HEARTBEAT_MS = 25_000;

export async function GET(req: NextRequest) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return new Response('Brak dostępu.', { status: 403 });
  }

  // Shared cap with api/events/route.ts — see sseConnectionLimit.ts's doc
  // comment for why this is keyed by userId alone, not per-route.
  const acquiredSlotId = acquireSseSlot(user.id);
  if (!acquiredSlotId) {
    return new Response('Za dużo otwartych połączeń.', { status: 429 });
  }
  // Re-bound as a plain `string` (not `string | null`) — TypeScript doesn't
  // carry the null-check narrowing above across the closures below (cleanup,
  // the heartbeat interval) that reference it.
  const slotId: string = acquiredSlotId;

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval>;
  let cleanedUp = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        // The client can disconnect between an event firing and this running;
        // enqueueing on an already-closed controller throws, and this must
        // not crash the shared listener loop other open connections rely on.
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // handled by cleanup() below once the platform notices the disconnect
        }
      };

      // 'alerts'/'resources'/'alert-messages' carry a real cross-gmina
      // boundary (see api/events/route.ts's own comment) that a COORDINATOR
      // — always gmina-scoped, unlike an ADMIN, who may be global
      // (gminaId === null) — must not see past, even over THIS connection.
      // Fixing that only on api/events/route.ts and not here would have
      // left it exploitable via the exact same account simply by reading
      // this route's stream instead: every ADMIN/COORDINATOR session opens
      // both connections at once (see components/layout/ProtectedShell.tsx).
      // The admin-only scopes (users/invites/logs/gminas/organizations)
      // stay unfiltered — that's the existing, separate decision that audit
      // visibility isn't gmina-restricted (see lib/auditLog.ts's own
      // comment), not something this fix changes.
      const gminaScopedScopes: Set<string> = new Set(['alerts', 'resources', 'alert-messages']);
      unsubscribe = subscribeToAdminEvents((event) => {
        if (gminaScopedScopes.has(event.scope) && user.gminaId && event.gminaId && event.gminaId !== user.gminaId) {
          return;
        }
        send(`data: ${JSON.stringify(event)}\n\n`);
      });
      // Also the sseConnectionLimit.ts safety net: a tick here means this
      // connection is still genuinely alive, so its slot isn't swept as
      // stale even if cleanup() below never runs (see that module's doc
      // comment).
      heartbeat = setInterval(() => {
        send(': heartbeat\n\n');
        touchSseSlot(slotId);
      }, HEARTBEAT_MS);

      // The real fix for the leak this whole module exists to prevent: an
      // abrupt client disconnect (closed tab, dead wifi) does NOT reliably
      // invoke ReadableStream's own cancel() below on every Node/Next.js
      // version — but req.signal is the standard Fetch AbortSignal wired
      // directly to the underlying request/socket lifecycle, and Next.js
      // aborts it whenever that connection tears down, cancel() or not.
      // Without this, an unreliable cancel() left the heartbeat timer AND
      // this listener running in lib/adminEvents.ts's process-wide
      // `listeners` Set forever — a zombie accumulating without bound over
      // days of churn until the process runs out of heap.
      req.signal.addEventListener('abort', cleanup);
      // See api/events/route.ts's matching comment — addEventListener only
      // fires on a FUTURE abort; if the client had already disconnected
      // before this stream started, that listener would otherwise never
      // fire at all.
      if (req.signal.aborted) cleanup();
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    unsubscribe();
    clearInterval(heartbeat);
    releaseSseSlot(slotId);
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Reverse proxies that buffer responses (nginx-style) would otherwise
      // hold every chunk until the buffer fills, defeating the whole point.
      'X-Accel-Buffering': 'no',
    },
  });
}
