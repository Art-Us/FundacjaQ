import { requireUser } from '@/lib/authz';
import { adminEventStreamResponse } from '@/lib/eventStream';

export const runtime = 'nodejs';

// Alert-change notifications for every logged-in user, VOLUNTEER included —
// alerts are visible to everyone, so hearing that one changed is too. Each
// event only carries the alert id (lib/alertEvents.ts); the listening page
// then re-reads through its own normal server render.
export async function GET() {
  const user = await requireUser();
  if (!user) {
    return new Response('Brak dostępu.', { status: 403 });
  }

  return adminEventStreamResponse((event) => event.scope === 'alerts');
}
