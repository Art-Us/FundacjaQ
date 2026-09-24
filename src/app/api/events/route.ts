import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/authz';
import { subscribeToAdminEvents } from '@/lib/adminEvents';
import { acquireSseSlot, releaseSseSlot, touchSseSlot } from '@/lib/sseConnectionLimit';

export const runtime = 'nodejs';

// Same idea as api/admin/events/route.ts, but for the 'alerts'/'resources'
// scopes any signed-in user may need (a VOLUNTEER on /map, not just
// ADMIN/COORDINATOR) — see adminEvents.ts's doc comment for why this shares
// the admin route's Redis channel/subscriber instead of standing up a second
// one, and why an ADMIN/COORDINATOR tab harmlessly receiving these events
// twice (once here, once over its own /api/admin/events connection) is fine.
const HEARTBEAT_MS = 25_000;

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return new Response('Brak dostępu.', { status: 403 });
  }

  // See sseConnectionLimit.ts's doc comment — without this cap, being
  // signed in at all (any role, including VOLUNTEER) is enough to open
  // unboundedly many of these and exhaust server sockets/memory.
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

      const publicScopes: Set<string> = new Set(['alerts', 'resources', 'alert-messages', 'user-notice']);
      unsubscribe = subscribeToAdminEvents((event) => {
        // Never forward admin-only scopes ('users'/'invites'/'logs'/
        // 'gminas'/'organizations') to a connection any signed-in user can
        // open — this route has no ADMIN/COORDINATOR check.
        if (!publicScopes.has(event.scope)) return;
        // 'user-notice' is targeted, not broadcast — see AdminEvent.targetUserId's
        // doc comment. Every other scope has no targetUserId set and skips this.
        if (event.scope === 'user-notice' && event.targetUserId !== user.id) return;
        // The gmina boundary MUST be enforced here, not just trusted to
        // hooks/useAppEvents's client-side gminaId filter — that filter is a
        // UI convenience only, trivially bypassed by reading this raw SSE
        // stream directly (devtools' Network tab, a one-line
        // `new EventSource(...).onmessage = console.log`, curl with a
        // stolen cookie). Without this, a gmina-scoped VOLUNTEER — no
        // special access needed, just being signed in — would receive every
        // OTHER gmina's alert/resource/alert-message activity metadata
        // (scope, action, alertId) over the wire nationwide, even though the
        // UI never renders it. Same "unset gminaId always passes" semantics
        // as that client-side filter (see adminEvents.ts's AdminEvent.gminaId
        // doc comment) — this only ever narrows what gets sent, never widens
        // it, and a global admin (user.gminaId === null) is unrestricted.
        if (user.gminaId && event.gminaId && event.gminaId !== user.gminaId) return;
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
      // addEventListener only fires on a FUTURE abort — if the client had
      // already disconnected in the (async, `await requireUser()`-sized)
      // gap between this request arriving and this stream starting, the
      // signal is already aborted and that listener would otherwise never
      // fire, leaving this slot to rely on the 70s TTL sweep instead of
      // cleaning up immediately.
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
