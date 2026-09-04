import { Prisma } from '@prisma/client';

// Shared by the admin user CRUD routes — never include passwordHash here.
export const adminUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  organization: true,
  phone: true,
  gminaId: true,
  isActive: true,
  emailVerified: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
