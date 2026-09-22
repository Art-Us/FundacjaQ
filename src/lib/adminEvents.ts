import type { Redis } from 'ioredis';
import { redis } from './redis';

// Server-Sent-Events fan-out for the admin panel (users/invites/logs), so an
// admin looking at one of those pages sees another admin's change without a
// manual reload. One Redis channel carries every scope — the SSE route and
// each page filter locally — rather than one channel per scope, since the
// volume here (admin actions, not chat) never justifies the extra channels.
//
// 'alerts'/'resources' ride the same channel but are consumed by a SEPARATE
// route (api/events/route.ts, gated by requireUser — any signed-in user,
// not just ADMIN/COORDINATOR) so a VOLUNTEER on /map can get live alert
// updates without ever touching the admin-only /api/admin/events route. An
// ADMIN/COORDINATOR tab still gets these same events a second time over its
// existing admin connection (subscribeToAdminEvents forwards every scope to
// every listener) — harmless, since AppEventsRefresh's router.refresh() is
// idempotent either way.
const CHANNEL = 'admin-events';

// 'alert-messages' is deliberately its OWN scope, not folded into 'alerts' —
// a chat/journal message is much higher-frequency than an alert's own
// lifecycle (create/status/needs/allocations) and, unlike those, only ever
// matters to whoever has THAT ONE alert's detail page open (see `id` below).
// Keeping it separate means a busy forum thread never triggers a
// router.refresh() on /map or on every OTHER alert's detail page — only
// AlertOperationalJournal.tsx subscribes to it at all.
export type AdminEventScope =
  | 'users'
  | 'invites'
  | 'logs'
  | 'gminas'
  | 'organizations'
  | 'alerts'
  | 'resources'
  | 'alert-messages';

export interface AdminEvent {
  scope: AdminEventScope;
  // Which AuditAction caused this, when the publisher knows it (recordAudit
  // always does; a couple of direct callers that don't go through the audit
  // log, like invite acceptance, still set it by hand). Optional because
  // not every listener cares — right now only the new-pending-user notifier
  // (components/NewUserNotifier.tsx) distinguishes 'USER_CREATE' from every
  // other 'users'-scope change.
  action?: string;
  // The specific entity this event is about — currently only set for
  // 'alert-messages' (the alertId), so AlertOperationalJournal.tsx can ignore
  // every alert except its own instead of refetching on ANY alert's chat
  // activity. Every other scope stays id-less (a plain "something in this
  // scope changed, go re-fetch your list" signal) since those lists don't
  // have a single entity to filter down to.
  id?: string;
}

/** Best-effort — a dropped event just means an open tab waits for its own next action or a manual reload, exactly like before this existed. */
export async function publishAdminEvent(event: AdminEvent): Promise<void> {
  try {
    await redis.publish(CHANNEL, JSON.stringify(event));
  } catch (err) {
    console.error('[adminEvents] publish failed (non-fatal):', err);
  }
}

type Listener = (event: AdminEvent) => void;

// One shared Redis subscriber connection for the whole process, not one per
// SSE client: ioredis requires a dedicated connection once it enters
// subscriber mode (it can no longer run ordinary commands), so this is a
// redis.duplicate() created lazily on the first SSE connection. Stashed on
// globalThis in dev (matching lib/redis.ts's own pattern) so a hot-reload
// reuses the same connection and listener set instead of leaking a new
// subscriber every time this module re-evaluates.
const globalForAdminEvents = globalThis as unknown as {
  adminEventsSubscriber: Redis | undefined;
  adminEventsListeners: Set<Listener> | undefined;
};

const listeners = globalForAdminEvents.adminEventsListeners ?? new Set<Listener>();
if (process.env.NODE_ENV !== 'production') globalForAdminEvents.adminEventsListeners = listeners;

// A true module-scope singleton (not just conditionally stashed on
// globalThis) — getSubscriber() is called once per SSE connection, so a
// singleton that only persisted in dev would mean production duplicates the
// connection on every call. globalForAdminEvents is still consulted/updated
// so a dev hot-reload reuses the same connection instead of leaking one.
let subscriberInstance: Redis | undefined = globalForAdminEvents.adminEventsSubscriber;

function getSubscriber(): Redis {
  if (!subscriberInstance) {
    subscriberInstance = redis.duplicate();
    // Required — see lib/redis.ts's own 'error' listener for why an
    // unhandled one would crash the process instead of just logging.
    subscriberInstance.on('error', (err) => console.error('[adminEvents] subscriber connection error:', err));
    subscriberInstance.subscribe(CHANNEL).catch((err) => console.error('[adminEvents] subscribe failed:', err));
    subscriberInstance.on('message', (_channel, message) => {
      let event: AdminEvent;
      try {
        const parsed: unknown = JSON.parse(message);
        // Guards the `.scope` access every listener does next — a stray
        // PUBLISH on this channel from outside this module (a debugging
        // `redis-cli PUBLISH admin-events null`, a future bug, a shared Redis
        // instance) must not reach listener code with a non-object payload.
        if (typeof parsed !== 'object' || parsed === null || typeof (parsed as AdminEvent).scope !== 'string') {
          return;
        }
        event = parsed as AdminEvent;
      } catch {
        return;
      }
      // Each listener runs in its own try/catch: this fires from inside
      // ioredis's own 'message' emission, with no Next.js request boundary
      // around it — one listener throwing here would otherwise be an
      // uncaught exception that crashes the whole process (every open
      // connection, not just the one at fault), not just fail one request.
      listeners.forEach((listener) => {
        try {
          listener(event);
        } catch (err) {
          console.error('[adminEvents] listener threw (non-fatal):', err);
        }
      });
    });
    if (process.env.NODE_ENV !== 'production') globalForAdminEvents.adminEventsSubscriber = subscriberInstance;
  }
  return subscriberInstance;
}

/** Registers `listener` for every published AdminEvent; returns an unsubscribe function. Called from the SSE route (lib/adminEvents.ts's only intended caller) once per open connection. */
export function subscribeToAdminEvents(listener: Listener): () => void {
  getSubscriber();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
