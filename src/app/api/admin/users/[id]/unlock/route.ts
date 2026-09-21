import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, canManageUser } from '@/lib/authz';
import { recordAudit, requestMeta } from '@/lib/auditLog';
import { resetAttempts } from '@/lib/lockout';
import { clearAttempts } from '@/lib/attemptTracker';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) {
    return NextResponse.json({ error: 'Użytkownik nie istnieje.' }, { status: 404 });
  }

  if (!canManageUser(user, target)) {
    return NextResponse.json({ error: 'Nie masz uprawnień do zarządzania tym użytkownikiem.' }, { status: 403 });
  }

  const wasLocked = target.lockedUntil !== null && target.lockedUntil.getTime() > Date.now();
  if (!wasLocked && target.failedAttempts === 0) {
    return NextResponse.json({ message: 'Konto nie jest zablokowane.' });
  }

  // resetAttempts clears both the Redis fast-path key and the Postgres
  // failedAttempts/lockedUntil columns, and invalidates the cached session
  // status — see lib/lockout.ts. Also clears the softer 'login-account'
  // attempt counter (lib/attemptTracker.ts) that gates the login captcha
  // challenge, so an admin-unlocked user isn't immediately re-challenged by
  // a counter this action didn't otherwise touch. The two are independent
  // (different Redis keys, and clearAttempts never touches Postgres), so
  // they run concurrently.
  const [wasReset] = await Promise.all([
    resetAttempts(target.email),
    clearAttempts('login-account', target.email),
  ]);

  // resetAttempts is best-effort on its original (login-success) call sites
  // by design — it must never block an already-authenticated login. Here,
  // though, the caller is an admin who explicitly asked to lift a lockout:
  // silently reporting success (and writing an audit entry) while the
  // Postgres write actually failed — a DB blip, or the account being
  // deleted by another admin in the same instant — would leave the account
  // still locked with no visible sign anything went wrong.
  if (!wasReset) {
    return NextResponse.json({ error: 'Nie udało się zdjąć blokady konta. Spróbuj ponownie.' }, { status: 500 });
  }

  await recordAudit({
    actor: user,
    action: 'USER_UNLOCK',
    entityType: 'USER',
    entityId: target.id,
    gminaId: target.gminaId,
    before: { failedAttempts: target.failedAttempts, lockedUntil: target.lockedUntil },
    after: { failedAttempts: 0, lockedUntil: null },
    meta: requestMeta(req),
  });

  return NextResponse.json({ message: 'Blokada konta została zdjęta.' });
}
