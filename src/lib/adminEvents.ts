import type { Redis } from 'ioredis';
import { redis } from './redis';

// Server-Sent-Events fan-out for the admin panel (users/invites/logs), so an
// admin looking at one of those pages sees another admin's change without a
// manual reload. One Redis channel carries every scope — the SSE route and
// each page filter locally — rather than one channel per scope, since the
// volume here (admin actions, not chat) never justifies the extra channels.
const CHANNEL = 'admin-events';

export type AdminEventScope = 'users' | 'invites' | 'logs' | 'gminas' | 'organizations';

export interface AdminEvent {
  scope: AdminEventScope;
  // Which AuditAction caused this, when the publisher knows it (recordAudit
  // always does; a couple of direct callers that don't go through the audit
  // log, like invite acceptance, still set it by hand). Optional because
  // not every listener cares — right now only the new-pending-user notifier
  // (components/NewUserNotifier.tsx) distinguishes 'USER_CREATE' from every
  // other 'users'-scope change.
  action?: string;
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

function getSubscriber(): Redis {
  let subscriber = globalForAdminEvents.adminEventsSubscriber;
  if (!subscriber) {
    subscriber = redis.duplicate();
    subscriber.subscribe(CHANNEL).catch((err) => console.error('[adminEvents] subscribe failed:', err));
    subscriber.on('message', (_channel, message) => {
      let event: AdminEvent;
      try {
        event = JSON.parse(message);
      } catch {
        return;
      }
      listeners.forEach((listener) => listener(event));
    });
    if (process.env.NODE_ENV !== 'production') globalForAdminEvents.adminEventsSubscriber = subscriber;
  }
  return subscriber;
}

/** Registers `listener` for every published AdminEvent; returns an unsubscribe function. Called from the SSE route (lib/adminEvents.ts's only intended caller) once per open connection. */
export function subscribeToAdminEvents(listener: Listener): () => void {
  getSubscriber();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
