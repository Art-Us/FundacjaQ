import { subscribeToAdminEvents, type AdminEvent } from './adminEvents';

// Keeps the connection alive through a reverse proxy's idle-connection
// timeout (Azure App Service's front end included) — without a steady trickle
// of bytes, a long-idle SSE stream gets silently dropped and the browser has
// to notice and reconnect instead of just staying open.
const HEARTBEAT_MS = 25_000;

/**
 * A Server-Sent-Events response forwarding every AdminEvent that passes
 * `filter` — shared by /api/admin/events (admin panel) and /api/events
 * (alert changes, every logged-in user). The caller does its own auth check
 * before calling this.
 */
export function adminEventStreamResponse(filter: (event: AdminEvent) => boolean): Response {
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
        if (filter(event)) send(`data: ${JSON.stringify(event)}\n\n`);
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
