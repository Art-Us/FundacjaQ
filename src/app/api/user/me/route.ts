import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/authz';
import { recordAttempt, isCaptchaRequired, markCaptchaRequired } from '@/lib/attemptTracker';
import { verifyCaptcha } from '@/lib/captcha';
import { parseClientIp } from '@/lib/clientIp';

export const runtime = 'nodejs';

const selfProfileSelect = { id: true, name: true, email: true, phone: true } as const;

const updateSelfSchema = z.object({
  name: z.string().trim().min(1, 'Podaj imię i nazwisko.').max(200),
  email: z.string().trim().email('Podaj poprawny adres email.'),
  phone: z.string().trim().max(30).nullable().optional(),
  captchaToken: z.string().nullish(),
});

// This endpoint lets any signed-in user (including a low-privilege VOLUNTEER)
// probe whether an arbitrary email is already registered, via the
// email-already-exists error below — a step-up captcha is the mitigation,
// same tool used for login/forgot-password (lib/captcha.ts, lib/attemptTracker.ts),
// just with different trigger semantics: those re-derive "captcha required"
// from a live rolling attempt count each request, so it can lapse the moment
// attempts stop; this one latches on at the 5th PATCH attempt and then stays
// required for a full hour regardless of what happens after — see
// markCaptchaRequired's own doc comment.
const CAPTCHA_SCOPE = 'profile-update';
const CAPTCHA_ATTEMPT_THRESHOLD = 5;
const CAPTCHA_STICKY_SECONDS = 60 * 60;

/** Lets any signed-in user read their own name/email/phone, to prefill the self-service profile modal (Sidebar's avatar/name button). */
export async function GET() {
  const actor = await requireUser();
  if (!actor) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: selfProfileSelect });
  if (!user) {
    return NextResponse.json({ error: 'Użytkownik nie istnieje.' }, { status: 404 });
  }

  return NextResponse.json({ user });
}

/**
 * Lets any signed-in user update their own name/email/phone — deliberately
 * narrower than PATCH /api/admin/users/[id]: no role/gminaId/organizationId/
 * isActive here, since this route needs no admin/coordinator authorization at
 * all (requireUser() accepts any role). Not audited (unlike the admin route),
 * per product decision — self-edits of one's own contact details aren't
 * tracked in the admin audit log.
 */
export async function PATCH(req: NextRequest) {
  const actor = await requireUser();
  if (!actor) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 401 });
  }

  // Checked before this request's own attempt is recorded below, so the
  // request that pushes the count to the threshold is itself still let
  // through — the challenge starts biting from the NEXT attempt onward.
  const captchaChallengeActive = await isCaptchaRequired(CAPTCHA_SCOPE, actor.id);

  // Counts every PATCH attempt, success or failure — an attacker probing
  // emails via the collision error below drives exactly this loop, so
  // volume alone (not just failures) is the right signal.
  const attempts = await recordAttempt(CAPTCHA_SCOPE, actor.id, CAPTCHA_STICKY_SECONDS);
  if (attempts >= CAPTCHA_ATTEMPT_THRESHOLD) {
    await markCaptchaRequired(CAPTCHA_SCOPE, actor.id, CAPTCHA_STICKY_SECONDS);
  }

  const parsed = updateSelfSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  if (captchaChallengeActive) {
    const ip = parseClientIp(req.headers.get('x-forwarded-for'));
    if (!(await verifyCaptcha(parsed.data.captchaToken, ip))) {
      return NextResponse.json(
        { error: 'Zbyt wiele prób. Potwierdź, że nie jesteś robotem.', captchaRequired: true },
        { status: 400 }
      );
    }
  }

  const { name, email, phone } = parsed.data;

  if (email !== actor.email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'Konto dla tego adresu email już istnieje.' }, { status: 400 });
    }
  }

  try {
    const user = await prisma.user.update({
      where: { id: actor.id },
      data: { name, email, phone: phone || null },
      select: selfProfileSelect,
    });
    return NextResponse.json({ user });
  } catch (err) {
    // The email-collision check above already covers the common case — this
    // only fires on a genuine race (two concurrent updates to the same new
    // email), a real P2002 unique-constraint hit.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Konto dla tego adresu email już istnieje.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Nie udało się zaktualizować profilu.' }, { status: 400 });
  }
}
