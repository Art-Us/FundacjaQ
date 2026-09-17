export const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-rose-950 text-rose-300 border-rose-800',
  HIGH: 'bg-orange-950 text-orange-300 border-orange-800',
  MEDIUM: 'bg-amber-950 text-amber-300 border-amber-800',
  LOW: 'bg-slate-800 text-slate-300 border-slate-700',
};

export const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: 'Krytyczny',
  HIGH: 'Wysoki',
  MEDIUM: 'Średni',
  LOW: 'Niski',
};

// Odznaka krytyczności na kartach alertów (kolorowa plakietka + kropka) — osobny
// zestaw klas od SEVERITY_STYLES powyżej (które kolorują całą kartę), żeby oba
// warianty dało się nałożyć razem bez konfliktu specyficzności.
export const SEVERITY_BADGE_INFO: Record<string, { badgeClass: string; dotClass: string }> = {
  CRITICAL: { badgeClass: 'bg-red-50 text-red-700 border-red-200', dotClass: 'bg-red-500' },
  HIGH: { badgeClass: 'bg-orange-50 text-orange-700 border-orange-200', dotClass: 'bg-orange-500' },
  MEDIUM: { badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500' },
  LOW: { badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotClass: 'bg-emerald-500' },
};

export function getSeverityBadgeInfo(severity: string) {
  return SEVERITY_BADGE_INFO[severity] ?? SEVERITY_BADGE_INFO.LOW;
}

// Formatuje różnicę czasu (ms) w zwięzły zapis "Nd Nh" / "Nh Nmin" / "N min" —
// używane do pokazania czasu trwania zdarzenia (od utworzenia do ostatniej zmiany).
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0 min';
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}min`;
  return `${minutes} min`;
}

export const ALERT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Aktywny',
  IN_PROGRESS: 'W trakcie',
  RESOLVED: 'Rozwiązany',
  CANCELLED: 'Anulowany',
};

export const ALERT_CATEGORY_LABELS: Record<string, string> = {
  // kind = ALERT
  HYDROLOGICAL: 'Ostrzeżenie hydrologiczne',
  ROAD: 'Komunikat drogowy',
  HUMANITARIAN: 'Pomoc humanitarna',
  FIRE: 'Zagrożenie pożarowe',
  INFRASTRUCTURE: 'Awaria infrastruktury',
  GENERAL: 'Informacja ogólna',
  // kind = EVENT
  FESTIVAL: 'Festyn / święto miasta',
  CONCERT: 'Koncert',
  SPORT: 'Wydarzenie sportowe',
  COMMUNITY: 'Spotkanie mieszkańców',
  FAIR: 'Targi / jarmark',
  CULTURE: 'Kultura / wystawa',
  OTHER_EVENT: 'Inne wydarzenie',
};

export type AlertKindValue = 'ALERT' | 'EVENT';

// Kategorie są jedną kolumną w bazie (AlertCategory), ale każdy `kind` używa
// tylko swojego podzbioru — te dwie listy są źródłem prawdy dla formularzy,
// filtrów, legendy mapy i walidacji w API.
export const ALERT_CATEGORIES = [
  'HYDROLOGICAL',
  'ROAD',
  'HUMANITARIAN',
  'FIRE',
  'INFRASTRUCTURE',
  'GENERAL',
] as const;

export const EVENT_CATEGORIES = [
  'FESTIVAL',
  'CONCERT',
  'SPORT',
  'COMMUNITY',
  'FAIR',
  'CULTURE',
  'OTHER_EVENT',
] as const;

export const KIND_LABELS: Record<AlertKindValue, string> = {
  ALERT: 'Alerty',
  EVENT: 'Zdarzenia codzienne',
};

export const DEFAULT_CATEGORY_FOR_KIND: Record<AlertKindValue, string> = {
  ALERT: 'GENERAL',
  EVENT: 'FESTIVAL',
};

export function categoriesForKind(kind: AlertKindValue): readonly string[] {
  return kind === 'EVENT' ? EVENT_CATEGORIES : ALERT_CATEGORIES;
}

export function isCategoryValidForKind(category: string, kind: AlertKindValue): boolean {
  return categoriesForKind(kind).includes(category);
}

// Kolor pinezki wg kategorii. Komunikaty kryzysowe mogą być kolorowane wg
// kategorii albo krytyczności (SEVERITY_MARKER_COLORS), natomiast zdarzenia
// codzienne zawsze wg typu wydarzenia — dlatego każdy typ EVENT ma tu własny,
// wyraźnie odrębny kolor.
export const CATEGORY_MARKER_COLORS: Record<string, string> = {
  // kind = ALERT
  HYDROLOGICAL: '#0ea5e9',
  ROAD: '#f59e0b',
  HUMANITARIAN: '#10b981',
  FIRE: '#ef4444',
  INFRASTRUCTURE: '#8b5cf6',
  GENERAL: '#64748b',
  // kind = EVENT
  FESTIVAL: '#ec4899',
  CONCERT: '#a855f7',
  SPORT: '#22c55e',
  COMMUNITY: '#0ea5e9',
  FAIR: '#f59e0b',
  CULTURE: '#14b8a6',
  OTHER_EVENT: '#64748b',
};

// Leaflet rysuje pinezki jako SVG i potrzebuje realnego koloru, nie klasy Tailwind —
// te wartości odpowiadają odcieniom użytym w SEVERITY_STYLES powyżej.
export const SEVERITY_MARKER_COLORS: Record<string, string> = {
  CRITICAL: '#f43f5e',
  HIGH: '#f97316',
  MEDIUM: '#f59e0b',
  LOW: '#22c55e',
};

// Konwertuje kolor hex (np. z *_MARKER_COLORS) na rgba() z zadaną przezroczystością —
// używane do rysowania odznak (badge) tym samym kolorem co pinezka na mapie, bez
// trzymania osobnego zestawu klas Tailwind dla każdej kategorii/krytyczności.
export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
