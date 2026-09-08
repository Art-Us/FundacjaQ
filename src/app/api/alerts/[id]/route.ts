import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';

export const runtime = 'nodejs';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const ALERT_STATUSES = ['ACTIVE', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const;
const CATEGORIES = ['HYDROLOGICAL', 'ROAD', 'HUMANITARIAN', 'FIRE', 'INFRASTRUCTURE', 'GENERAL'] as const;

const updateAlertSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(ALERT_STATUSES).optional(),
  category: z.enum(CATEGORIES).optional(),
  location: z.string().max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const alert = await prisma.alert.findUnique({ where: { id: params.id } });
  if (!alert) {
    return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
  }

  // ADMIN może edytować dowolny alert; COORDINATOR tylko w swojej gminie.
  if (user.role !== 'ADMIN' && alert.gminaId !== user.gminaId) {
    return NextResponse.json({ error: 'Nie masz uprawnień do edycji tego alertu.' }, { status: 403 });
  }

  const parsed = updateAlertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'Brak zmian do zapisania.' }, { status: 400 });
  }

  await prisma.alert.update({ where: { id: alert.id }, data: parsed.data });

  return NextResponse.json({ message: 'Alert zaktualizowany.' });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  // Usuwanie na twardo tylko dla ADMIN — COORDINATOR może co najwyżej zmienić
  // status na RESOLVED/CANCELLED (PATCH powyżej), zgodnie z zasadą zachowania
  // historii zdarzeń zamiast ich kasowania.
  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Tylko administrator może trwale usunąć alert.' }, { status: 403 });
  }

  const alert = await prisma.alert.findUnique({ where: { id: params.id } });
  if (!alert) {
    return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
  }

  await prisma.alert.delete({ where: { id: alert.id } });

  return NextResponse.json({ message: 'Alert usunięty.' });
}
