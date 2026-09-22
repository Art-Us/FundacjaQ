// Etykiety i kolory odznak dla AlertMessageType — tagi kolorowe na kartach
// wpisów w dzienniku operacyjnym/forum alertu (R12, docs/resource_management_plan.md
// Крок 51), wzorowane na wzorcu {label, badgeClass, dotClass} z resourceLabels.ts.
// Dotyczy tylko wpisów głównych (parentId = null) — odpowiedzi w czacie pod
// wpisem nie mają typu.

interface BadgeInfo {
  label: string;
  badgeClass: string;
  dotClass: string;
}

// Canonical ordered list of the enum's values — shared by the create-entry
// API route's zod schema (Крок 53) and the "+ Stwórz nowy wpis" type
// <select> (Крок 57), so neither has to duplicate the enum's members.
export const ALERT_MESSAGE_TYPES = [
  'STAFF_COMMUNIQUE',
  'SITUATION_UPDATE',
  'LOGISTICS_TRANSPORT',
  'UNIT_SUPPORT',
  'OTHER',
] as const;

export const ALERT_MESSAGE_TYPE_LABELS: Record<string, BadgeInfo> = {
  STAFF_COMMUNIQUE: {
    label: 'Komunikat sztabowy',
    badgeClass: 'bg-violet-50 text-violet-700 border-violet-200',
    dotClass: 'bg-violet-500',
  },
  SITUATION_UPDATE: {
    label: 'Aktualizacja sytuacji',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
    dotClass: 'bg-sky-500',
  },
  LOGISTICS_TRANSPORT: {
    label: 'Logistyka i Transport',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
    dotClass: 'bg-orange-500',
  },
  UNIT_SUPPORT: {
    label: 'Wsparcie jednostek',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotClass: 'bg-emerald-500',
  },
  OTHER: {
    label: 'Inne',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
    dotClass: 'bg-slate-500',
  },
};

export function getAlertMessageTypeInfo(type: string): BadgeInfo {
  // Falls back to OTHER — unlike the other enums in resourceLabels.ts, this
  // one has no @default in schema.prisma (type is only set on root entries),
  // so OTHER is just the safest catch-all for an unrecognized value.
  return ALERT_MESSAGE_TYPE_LABELS[type] ?? ALERT_MESSAGE_TYPE_LABELS.OTHER;
}
