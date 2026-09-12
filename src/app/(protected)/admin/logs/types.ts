export interface AuditLogItem {
  id: string;
  actorId: string;
  actorEmail: string;
  actorName: string | null;
  actorRole: string;
  action: string;
  entityType: 'USER' | 'GMINA' | 'INVITE_TOKEN';
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
  INVITE_CREATE: 'Wysłanie zaproszenia',
  INVITE_REVOKE: 'Unieważnienie zaproszenia',
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
  INVITE_TOKEN: 'Zaproszenie',
};

/** Best-effort human label for the affected record, read straight out of the snapshot so it still works after the record itself is gone. */
export function entityLabel(log: Pick<AuditLogItem, 'entityType' | 'entityId' | 'before' | 'after'>): string {
  const snapshot = (log.after ?? log.before) as Record<string, unknown> | null;
  if (!snapshot) return log.entityId;
  if (log.entityType === 'GMINA') return (snapshot.name as string) ?? log.entityId;
  return (snapshot.email as string) ?? log.entityId;
}
