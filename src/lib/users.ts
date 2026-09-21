import { Prisma, Role } from '@prisma/client';

// Shared between GET /api/admin/users (server-side "does this label match the
// search text" check) and UsersDirectory's role filter dropdown, so the two
// never drift apart.
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  COORDINATOR: 'Koordynator',
  VOLUNTEER: 'Wolontariusz',
};

// Shared by the admin user CRUD routes — never include passwordHash here.
export const adminUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  organizationId: true,
  organization: { select: { id: true, name: true } },
  phone: true,
  gminaId: true,
  isActive: true,
  lastActivatedAt: true,
  lastDeactivatedAt: true,
  deactivationReason: true,
  lockedUntil: true,
  emailVerified: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
