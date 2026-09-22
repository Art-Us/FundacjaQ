import { requireAdminOrCoordinator } from '@/lib/authz';
import { subscribeToAdminEvents } from '@/lib/adminEvents';
import { acquireSseSlot, releaseSseSlot, touchSseSlot } from '@/lib/sseConnectionLimit';

export const runtime = 'nodejs';

// Keeps the connection alive through a reverse proxy's idle-connection
// timeout (Azure App Service's front end included) — without a steady trickle
// of bytes, a long-idle SSE stream gets silently dropped and the browser has
// to notice and reconnect instead of just staying open.
const HEARTBEAT_MS = 25_000;

export async function GET() {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return new Response('Brak dostępu.', { status: 403 });
  }

  // Shared cap with api/events/route.ts — see sseConnectionLimit.ts's doc
  // comment for why this is keyed by userId alone, not per-route.
  const slotId = acquireSseSlot(user.id);
  if (!slotId) {
    return new Response('Za dużo otwartych połączeń.', { status: 429 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        // The client can disconnect between an event firing and this running;
        // enqueueing on an already-closed controller throws, and this must
        // not crash the shared listener loop other open connections rely on.
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // handled by cancel() below once the platform notices the disconnect
        }
      };

      unsubscribe = subscribeToAdminEvents((event) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });
      // Also the sseConnectionLimit.ts safety net: a tick here means this
      // connection is still genuinely alive, so its slot isn't swept as
      // stale even if cancel() below never runs (see that module's doc
      // comment on why cancel() firing isn't guaranteed).
      heartbeat = setInterval(() => {
        send(': heartbeat\n\n');
        touchSseSlot(slotId);
      }, HEARTBEAT_MS);
    },
    cancel() {
      unsubscribe();
      clearInterval(heartbeat);
      releaseSseSlot(slotId);
    },
  });

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
