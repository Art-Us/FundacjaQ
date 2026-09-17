// Etykiety i kolory odznak dla enumów modułu zasobów (ResourceGroup,
// ResourceHorizon, NeedUrgency, AllocationStatus) — wzorowane na
// SEVERITY_BADGE_INFO/getSeverityBadgeInfo w lib/alertLabels.ts: każdy wpis to
// {label, badgeClass, dotClass}, z gettera zawsze coś sensownego (fallback na
// wartość domyślną z schema.prisma), żeby nieznana/nowa wartość enuma nigdy
// nie zostawiła odznaki bez stylu.

interface BadgeInfo {
  label: string;
  badgeClass: string;
  dotClass: string;
}

export const RESOURCE_GROUP_LABELS: Record<string, BadgeInfo> = {
  PEOPLE: { label: 'Ludzie', badgeClass: 'bg-sky-50 text-sky-700 border-sky-200', dotClass: 'bg-sky-500' },
  WATER: { label: 'Woda', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200', dotClass: 'bg-blue-500' },
  EQUIPMENT: { label: 'Sprzęt', badgeClass: 'bg-slate-50 text-slate-700 border-slate-200', dotClass: 'bg-slate-500' },
  OTHER: { label: 'Inne', badgeClass: 'bg-purple-50 text-purple-700 border-purple-200', dotClass: 'bg-purple-500' },
};

export function getResourceGroupInfo(group: string): BadgeInfo {
  return RESOURCE_GROUP_LABELS[group] ?? RESOURCE_GROUP_LABELS.OTHER;
}

export const HORIZON_LABELS: Record<string, BadgeInfo> = {
  H24: { label: 'Do 24 godzin', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotClass: 'bg-emerald-500' },
  H48: { label: 'Do 48 godzin', badgeClass: 'bg-teal-50 text-teal-700 border-teal-200', dotClass: 'bg-teal-500' },
  H72: { label: 'Do 72 godzin', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500' },
  WEEK: { label: 'Do tygodnia', badgeClass: 'bg-slate-50 text-slate-700 border-slate-200', dotClass: 'bg-slate-500' },
};

export function getHorizonInfo(horizon: string): BadgeInfo {
  // Falls back to the schema's own @default(H24) for Resource.horizon.
  return HORIZON_LABELS[horizon] ?? HORIZON_LABELS.H24;
}

export const NEED_URGENCY_LABELS: Record<string, BadgeInfo> = {
  NORMAL: { label: 'Normalny', badgeClass: 'bg-slate-50 text-slate-700 border-slate-200', dotClass: 'bg-slate-500' },
  PILNE: { label: 'Pilne', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500' },
  KRYTYCZNY: { label: 'Krytyczny', badgeClass: 'bg-red-50 text-red-700 border-red-200', dotClass: 'bg-red-500' },
};

export function getNeedUrgencyInfo(urgency: string): BadgeInfo {
  // Falls back to the schema's own @default(NORMAL) for AlertNeed.urgency.
  return NEED_URGENCY_LABELS[urgency] ?? NEED_URGENCY_LABELS.NORMAL;
}

export const ALLOCATION_STATUS_LABELS: Record<string, BadgeInfo> = {
  DELIVERY_AGREED: {
    label: 'Uzgodniono dostawę',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
    dotClass: 'bg-sky-500',
  },
  DELIVERED: {
    label: 'Dostarczono',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    dotClass: 'bg-blue-500',
  },
  RETURN_AGREED: {
    label: 'Uzgodniono zwrot',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    dotClass: 'bg-amber-500',
  },
  PARTIALLY_RETURNED: {
    label: 'Częściowo zwrócono',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
    dotClass: 'bg-orange-500',
  },
  RETURNED: {
    label: 'Zwrócono',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotClass: 'bg-emerald-500',
  },
  CANCELLED: {
    label: 'Anulowano',
    badgeClass: 'bg-slate-100 text-slate-500 border-slate-200',
    dotClass: 'bg-slate-400',
  },
};

export function getAllocationStatusInfo(status: string): BadgeInfo {
  // Falls back to the schema's own @default(DELIVERY_AGREED) for ResourceAllocation.status.
  return ALLOCATION_STATUS_LABELS[status] ?? ALLOCATION_STATUS_LABELS.DELIVERY_AGREED;
}
