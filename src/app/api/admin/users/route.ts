import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { hashPassword, isPasswordPwned, passwordSchema } from '@/lib/password';
import { adminUserSelect } from '@/lib/users';

export const runtime = 'nodejs';

const ROLES = ['ADMIN', 'COORDINATOR', 'VOLUNTEER'] as const;

const createUserSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  role: z.enum(ROLES),
  gminaId: z.string().optional(),
  name: z.string().optional(),
  organization: z.string().optional(),
  phone: z.string().optional(),
});

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: adminUserSelect,
  });

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const parsed = createUserSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const { email, password, role, gminaId, name, organization, phone } = parsed.data;

  if (await isPasswordPwned(password)) {
    return NextResponse.json(
      { error: 'To hasło znajduje się w publicznych bazach wycieków. Wybierz inne.' },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'Konto dla tego adresu email już istnieje.' }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  try {
    // isActive: false — an admin-created account still needs an explicit
    // activation step, same as one created through the invite flow.
    const user = await prisma.user.create({
      data: { email, passwordHash, role, gminaId, name, organization, phone, isActive: false },
      select: adminUserSelect,
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Nie udało się utworzyć użytkownika. Sprawdź podane dane (np. gminę).' },
      { status: 400 }
    );
  }
}
