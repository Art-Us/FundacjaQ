import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { scopedGminaWhere, scopedGminaWhereAnyAdmin } from './gmina';
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
  // `role !== 'ADMIN'` alone used to be the whole test here, which was
  // correct back when every ADMIN was unrestricted — but a gmina-scoped
  // ADMIN (role === 'ADMIN', gminaId set) is gmina-scoped too now, so the
  // real test is "is this NOT an unrestricted global admin", independent of
  // role. Everyone else (COORDINATOR/VOLUNTEER, or a gmina-scoped ADMIN,
  // with or without a gmina of their own) is gmina-scoped.
  const isGlobalAdminActor = role === 'ADMIN' && gminaId === null;
  const isGminaScoped = !isGlobalAdminActor;
  // null means "gmina-scoped actor with no gmina of their own" — fail closed
  // (return nothing) rather than falling back to an unfiltered {}, which
  // would hand out every gmina's alerts/resources/user count. See
  // scopedGminaWhere's doc comment for the bug this replaced.
  const gminaFilter = scopedGminaWhere({ role, gminaId });
  const noAccess = gminaFilter === null;
  // Resources stay ADMIN-unconditional (any ADMIN, global or gmina-scoped,
  // sees every gmina's resources) — see scopedGminaWhereAnyAdmin's doc
  // comment. Deliberately a separate filter from gminaFilter above, which
  // still scopes usersCount/gminyCount/scopeLabel to a gmina-scoped admin's
  // own gmina. Alerts aren't scoped at all: everyone sees every gmina's.
  const resourceGminaFilter = scopedGminaWhereAnyAdmin({ role, gminaId });
  const resourceNoAccess = resourceGminaFilter === null;

  const [activeAlerts, gminyCount, usersCount, alerts, resources] = await Promise.all([
    prisma.alert.count({ where: { status: { in: ['ACTIVE', 'IN_PROGRESS'] } } }),
    // A gmina-scoped actor (COORDINATOR/VOLUNTEER, or a gmina-scoped ADMIN)
    // WITH a real gmina of their own sees only that one gmina's count, not
    // the system-wide total. The noAccess (no gmina at all) case is left
    // as-is — unscoped, same as the fail-closed alerts/resources/usersCount
    // tests already document as this endpoint's existing, deliberate
    // behavior for that edge case.
    isGminaScoped && !noAccess ? 1 : prisma.gmina.count(),
    noAccess ? 0 : prisma.user.count(isGminaScoped ? { where: gminaFilter! } : undefined),
    prisma.alert.findMany({
      include: alertInclude,
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: role === 'ADMIN' ? 10 : 8,
    }),
    resourceNoAccess
      ? Promise.resolve([])
      : prisma.resource.findMany({
          where: resourceGminaFilter,
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
