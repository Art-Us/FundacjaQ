import { requireAdminOrCoordinator } from '@/lib/authz';
import { adminEventStreamResponse } from '@/lib/eventStream';

export const runtime = 'nodejs';

export async function GET() {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return new Response('Brak dostępu.', { status: 403 });
  }

  // 'alerts' events have their own stream (/api/events), open to every role.
  return adminEventStreamResponse((event) => event.scope !== 'alerts');
}
