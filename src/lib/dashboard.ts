import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { scopedGminaWhere } from './gmina';
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
  // null means "gmina-scoped role with no gmina of their own" — fail closed
  // (return nothing) rather than falling back to an unfiltered {}, which
  // would hand out every gmina's alerts/resources/user count. See
  // scopedGminaWhere's doc comment for the bug this replaced.
  const gminaFilter = scopedGminaWhere({ role, gminaId });
  const noAccess = gminaFilter === null;

  // Zdarzenia codzienne (kind = EVENT) dzielą tabelę z komunikatami
  // kryzysowymi, ale panel kryzysowy musi liczyć i pokazywać wyłącznie alerty.
  const crisisFilter = { ...gminaFilter, kind: 'ALERT' as const };

  const [activeAlerts, gminyCount, usersCount, alerts, resources] = await Promise.all([
    noAccess
      ? 0
      : prisma.alert.count({ where: { ...gminaFilter, status: { in: ['ACTIVE', 'IN_PROGRESS'] } } }),
    prisma.gmina.count(),
    noAccess ? 0 : prisma.user.count(isGminaScoped ? { where: gminaFilter! } : undefined),
    noAccess
      ? Promise.resolve([])
      : prisma.alert.findMany({
          where: gminaFilter,
          include: alertInclude,
          orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
          take: role === 'ADMIN' ? 10 : 8,
        }),
    noAccess
      ? Promise.resolve([])
      : prisma.resource.findMany({
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
