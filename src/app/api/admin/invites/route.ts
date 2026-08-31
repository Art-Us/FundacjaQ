import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateToken, hashToken, INVITE_TOKEN_TTL_MS } from '@/lib/tokens';
import { sendInviteEmail, isEmailConfigured } from '@/lib/email';
import { consumeLimit, inviteCreateLimiter } from '@/lib/rateLimit';
import { requireAdminOrCoordinator } from '@/lib/authz';

export const runtime = 'nodejs';

const ROLES = ['ADMIN', 'COORDINATOR', 'VOLUNTEER'] as const;

const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(ROLES),
  gminaId: z.string().optional(),
});

export async function GET() {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const invites = await prisma.inviteToken.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ invites });
}

export async function POST(req: NextRequest) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const allowed = await consumeLimit(inviteCreateLimiter, user.id);
  if (!allowed) {
    return NextResponse.json({ error: 'Za dużo zaproszeń wysłanych w ostatnim czasie.' }, { status: 429 });
  }

  const parsed = createInviteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const { email, role, gminaId } = parsed.data;

  // Only ADMIN can grant ADMIN or COORDINATOR privileges.
  if ((role === 'ADMIN' || role === 'COORDINATOR') && user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Nie masz uprawnień do przypisania tej roli.' }, { status: 403 });
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: 'Konto dla tego adresu email już istnieje.' }, { status: 400 });
  }

  const rawToken = generateToken();
  await prisma.inviteToken.create({
    data: {
      email,
      role,
      gminaId,
      tokenHash: hashToken(rawToken),
      createdById: user.id,
      expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
    },
  });

  const inviteUrl = `${process.env.NEXTAUTH_URL}/invite/${rawToken}`;
  await sendInviteEmail(email, inviteUrl);

  return NextResponse.json({ message: 'Zaproszenie wysłane.', inviteUrl, emailConfigured: isEmailConfigured });
}
