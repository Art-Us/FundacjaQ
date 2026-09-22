import { requireUser } from '@/lib/authz';
import { subscribeToAdminEvents } from '@/lib/adminEvents';

export const runtime = 'nodejs';

// Same idea as api/admin/events/route.ts, but for the 'alerts'/'resources'
// scopes any signed-in user may need (a VOLUNTEER on /map, not just
// ADMIN/COORDINATOR) — see adminEvents.ts's doc comment for why this shares
// the admin route's Redis channel/subscriber instead of standing up a second
// one, and why an ADMIN/COORDINATOR tab harmlessly receiving these events
// twice (once here, once over its own /api/admin/events connection) is fine.
const HEARTBEAT_MS = 25_000;

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return new Response('Brak dostępu.', { status: 403 });
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
        // Never forward admin-only scopes ('users'/'invites'/'logs'/
        // 'gminas'/'organizations') to a connection any signed-in user can
        // open — this route has no ADMIN/COORDINATOR check.
        if (event.scope !== 'alerts' && event.scope !== 'resources') return;
        send(`data: ${JSON.stringify(event)}\n\n`);
      });
      heartbeat = setInterval(() => send(': heartbeat\n\n'), HEARTBEAT_MS);
    },
    cancel() {
      unsubscribe();
      clearInterval(heartbeat);
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
