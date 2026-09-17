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
  PEOPLE: { label: 'Ludzie', badgeClass: 'bg-purple-50 text-purple-700 border-purple-200', dotClass: 'bg-purple-500' },
  WATER: { label: 'Woda', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200', dotClass: 'bg-blue-500' },
  EQUIPMENT: { label: 'Sprzęt', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500' },
  OTHER: { label: 'Inne', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotClass: 'bg-emerald-500' },
};

export function getResourceGroupInfo(group: string): BadgeInfo {
  return RESOURCE_GROUP_LABELS[group] ?? RESOURCE_GROUP_LABELS.OTHER;
}

// Solid "selected" variants of the same group colors above — used where a
// pastel badge isn't enough to show something is actively chosen (filter
// chips, form buttons). Kept as literal class strings, not built with a
// template literal, so Tailwind's build-time scanner can see and keep them.
export const RESOURCE_GROUP_ACTIVE_CLASSES: Record<string, string> = {
  PEOPLE: 'bg-purple-600 text-white border-purple-600',
  WATER: 'bg-blue-600 text-white border-blue-600',
  EQUIPMENT: 'bg-amber-600 text-white border-amber-600',
  OTHER: 'bg-emerald-600 text-white border-emerald-600',
};

export function getResourceGroupActiveClass(group: string): string {
  return RESOURCE_GROUP_ACTIVE_CLASSES[group] ?? RESOURCE_GROUP_ACTIVE_CLASSES.OTHER;
}

export const HORIZON_LABELS: Record<string, BadgeInfo> = {
  H24: { label: 'Do 24 godzin', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotClass: 'bg-emerald-500' },
  H48: { label: 'Do 48 godzin', badgeClass: 'bg-teal-50 text-teal-700 border-teal-200', dotClass: 'bg-teal-500' },
  H72: { label: 'Do 72 godzin', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500' },
  // One notch darker than the other three pastel badges above — plain
  // bg-slate-50/border-slate-200 was nearly invisible against a white modal
  // background.
  WEEK: { label: 'Do tygodnia', badgeClass: 'bg-slate-100 text-slate-700 border-slate-300', dotClass: 'bg-slate-500' },
};

export function getHorizonInfo(horizon: string): BadgeInfo {
  // Falls back to the schema's own @default(H24) for Resource.horizon.
  return HORIZON_LABELS[horizon] ?? HORIZON_LABELS.H24;
}

// Solid "selected" variants of the horizon colors above — same rationale as
// RESOURCE_GROUP_ACTIVE_CLASSES.
export const HORIZON_ACTIVE_CLASSES: Record<string, string> = {
  H24: 'bg-emerald-600 text-white border-emerald-600',
  H48: 'bg-teal-600 text-white border-teal-600',
  H72: 'bg-amber-600 text-white border-amber-600',
  WEEK: 'bg-slate-600 text-white border-slate-600',
};

export function getHorizonActiveClass(horizon: string): string {
  return HORIZON_ACTIVE_CLASSES[horizon] ?? HORIZON_ACTIVE_CLASSES.H24;
}

// Compact "24h"-style form — used wherever the full "Do 24 godzin" label
// (HORIZON_LABELS) would be too verbose (matrix table columns, cell detail
// modal). Shared by ResourceMatrixView.tsx and ResourceMatrixCellDrawer.tsx.
export const HORIZON_SHORT_LABELS: Record<string, string> = {
  H24: '24h',
  H48: '48h',
  H72: '72h',
  WEEK: 'Tydzień',
};

export function getHorizonShortLabel(horizon: string): string {
  return HORIZON_SHORT_LABELS[horizon] ?? HORIZON_SHORT_LABELS.H24;
}

// Static, descriptive subtitles under each horizon — purely presentational
// (mirrors what "24h/48h/72h/tydzień" mean in practice), not derived from
// any data. Shared by the same two components as HORIZON_SHORT_LABELS above.
export const HORIZON_SUBTITLES: Record<string, string> = {
  H24: 'Natychmiastowe',
  H48: 'Krótkoterminowe',
  H72: 'Średnioterminowe',
  WEEK: 'Długoterminowe',
};

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
