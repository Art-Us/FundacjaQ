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

export const ALERT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Aktywny',
  IN_PROGRESS: 'W trakcie',
  RESOLVED: 'Rozwiązany',
  CANCELLED: 'Anulowany',
};

export const ALERT_CATEGORY_LABELS: Record<string, string> = {
  HYDROLOGICAL: 'Ostrzeżenie hydrologiczne',
  ROAD: 'Komunikat drogowy',
  HUMANITARIAN: 'Pomoc humanitarna',
  FIRE: 'Zagrożenie pożarowe',
  INFRASTRUCTURE: 'Awaria infrastruktury',
  GENERAL: 'Informacja ogólna',
};

// Kolor pinezki w podglądzie lokalizacji (LocationPicker) zależy od wybranej
// kategorii zdarzenia — niezależnie od SEVERITY_MARKER_COLORS, które kolorują
// pinezki na mapie przeglądowej wg krytyczności.
export const CATEGORY_MARKER_COLORS: Record<string, string> = {
  HYDROLOGICAL: '#0ea5e9',
  ROAD: '#f59e0b',
  HUMANITARIAN: '#10b981',
  FIRE: '#ef4444',
  INFRASTRUCTURE: '#8b5cf6',
  GENERAL: '#64748b',
};

// Leaflet rysuje pinezki jako SVG i potrzebuje realnego koloru, nie klasy Tailwind —
// te wartości odpowiadają odcieniom użytym w SEVERITY_STYLES powyżej.
export const SEVERITY_MARKER_COLORS: Record<string, string> = {
  CRITICAL: '#f43f5e',
  HIGH: '#f97316',
  MEDIUM: '#f59e0b',
  LOW: '#94a3b8',
};
