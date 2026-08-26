import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import type { Role } from '@/types';

const alertInclude = { gmina: true } satisfies Prisma.AlertInclude;
const resourceInclude = { gmina: true, category: true } satisfies Prisma.ResourceInclude;

type AlertWithGmina = Prisma.AlertGetPayload<{ include: typeof alertInclude }>;
type ResourceWithRelations = Prisma.ResourceGetPayload<{ include: typeof resourceInclude }>;

export interface DashboardStats {
  activeAlerts: number;
  gminyCount: number;
  usersCount: number;
}

export interface DashboardData {
  role: Role;
  scopeLabel: string;
  stats: DashboardStats;
  alerts: AlertWithGmina[];
  resources: ResourceWithRelations[];
  canManageInvites: boolean;
}

export async function getDashboardData(role: Role, gminaId: string | null): Promise<DashboardData> {
  const canManageInvites = role === 'ADMIN' || role === 'COORDINATOR';
  const isGminaScoped = role !== 'ADMIN';
  const gminaFilter = isGminaScoped && gminaId ? { gminaId } : {};

  const [activeAlerts, gminyCount, usersCount, alerts, resources] = await Promise.all([
    prisma.alert.count({ where: { ...gminaFilter, status: { in: ['ACTIVE', 'IN_PROGRESS'] } } }),
    prisma.gmina.count(),
    prisma.user.count(isGminaScoped && gminaId ? { where: { gminaId } } : undefined),
    prisma.alert.findMany({
      where: gminaFilter,
      include: alertInclude,
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: role === 'ADMIN' ? 10 : 8,
    }),
    prisma.resource.findMany({
      where: gminaFilter,
      include: resourceInclude,
      orderBy: { updatedAt: 'desc' },
      take: role === 'ADMIN' ? 10 : 8,
    }),
  ]);

  const scopeLabel = isGminaScoped
    ? gminaId
      ? 'Twoja gmina'
      : 'Brak przypisanej gminy'
    : 'Wszystkie gminy';

  return {
    role,
    scopeLabel,
    stats: { activeAlerts, gminyCount, usersCount },
    alerts,
    resources,
    canManageInvites,
  };
}
