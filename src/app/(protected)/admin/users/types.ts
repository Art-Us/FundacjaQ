export interface UserGmina {
  id: string;
  name: string;
}

export interface UserOrganization {
  id: string;
  name: string;
}

export type UserRole = 'ADMIN' | 'COORDINATOR' | 'VOLUNTEER';

export interface UserListItem {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  organization: UserOrganization | null;
  phone: string | null;
  isActive: boolean;
  lastActivatedAt: string | null;
  lastDeactivatedAt: string | null;
  deactivationReason: string | null;
  gmina: UserGmina | null;
  isSelf: boolean;
  canManage: boolean;
  lockedUntil: string | null;
}
