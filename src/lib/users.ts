import { Prisma } from '@prisma/client';

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
  emailVerified: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
