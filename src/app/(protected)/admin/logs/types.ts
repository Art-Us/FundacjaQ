export interface AuditLogItem {
  id: string;
  actorId: string;
  actorEmail: string;
  actorName: string | null;
  actorRole: string;
  action: string;
  entityType: 'USER' | 'GMINA' | 'ORGANIZATION' | 'INVITE_TOKEN';
  entityId: string;
  gminaId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  isRevert: boolean;
  revertOfId: string | null;
  revertedById: string | null;
  revertedAt: string | null;
  createdAt: string;
  canRevert: boolean;
}

export const ACTION_LABELS: Record<string, string> = {
  USER_CREATE: 'Utworzenie użytkownika',
  USER_UPDATE: 'Edycja użytkownika',
  USER_DELETE: 'Usunięcie użytkownika',
  USER_ACTIVATE: 'Aktywacja użytkownika',
  USER_DEACTIVATE: 'Dezaktywacja użytkownika',
  GMINA_CREATE: 'Utworzenie gminy',
  GMINA_UPDATE: 'Edycja gminy',
  GMINA_DELETE: 'Usunięcie gminy',
  ORGANIZATION_CREATE: 'Utworzenie organizacji',
  ORGANIZATION_UPDATE: 'Edycja organizacji',
  ORGANIZATION_DELETE: 'Usunięcie organizacji',
  INVITE_CREATE: 'Wysłanie zaproszenia',
  INVITE_REVOKE: 'Unieważnienie zaproszenia',
  INVITE_REACTIVATE: 'Ponowne wysłanie zaproszenia',
};

// Coarse action "kind" for the filter dropdown — which entity it's about is
// the separate entityType filter, so the kind doesn't repeat it. Mirrors
// ACTION_KINDS/ACTION_KIND_LABELS in src/lib/auditLog.ts (that module can't
// be imported here: it pulls in the Prisma client, which must never end up
// in a client bundle) — keep the two in sync if the grouping ever changes.
export const ACTION_KINDS = ['CREATE', 'UPDATE', 'DELETE', 'INVITE'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_KIND_LABELS: Record<ActionKind, string> = {
  CREATE: 'Dodanie',
  UPDATE: 'Edycja',
  DELETE: 'Usunięcie',
  INVITE: 'Zaproszenie',
};

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  USER: 'Użytkownik',
  GMINA: 'Gmina',
  ORGANIZATION: 'Organizacja',
  INVITE_TOKEN: 'Zaproszenie',
};

/** Best-effort human label for the affected record, read straight out of the snapshot so it still works after the record itself is gone. */
export function entityLabel(log: Pick<AuditLogItem, 'entityType' | 'entityId' | 'before' | 'after'>): string {
  const snapshot = (log.after ?? log.before) as Record<string, unknown> | null;
  if (!snapshot) return log.entityId;
  if (log.entityType === 'GMINA' || log.entityType === 'ORGANIZATION') return (snapshot.name as string) ?? log.entityId;
  return (snapshot.email as string) ?? log.entityId;
}

// --- Login attempt log ---------------------------------------------------
// Read-only, no revert — records self-service login attempts, not an admin
// acting on someone else, so there's no "before" admin-driven state to
// restore.

export interface LoginAttemptItem {
  id: string;
  email: string;
  userId: string | null;
  success: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}
