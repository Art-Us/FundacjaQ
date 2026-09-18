'use client';

import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import {
  CATEGORY_MARKER_COLORS,
  SEVERITY_MARKER_COLORS,
  ALERT_STATUS_LABELS,
  ALERT_CATEGORY_LABELS,
  SEVERITY_LABELS,
  ALERT_CATEGORIES,
  EVENT_CATEGORIES,
  hexToRgba,
} from '@/lib/alertLabels';
import type { AlertKindValue } from '@/lib/alertLabels';
import { createPinIcon, createEventPinIcon } from './pinIcon';
import { MapPin, Building, Calendar, Layers, Flame, ArrowRight } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import './leaflet-theme.css';

export type MapDisplayMode = 'category' | 'severity';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

export interface MapAlert {
  id: string;
  title: string;
  description: string;
  kind: string;
  severity: string;
  status: string;
  category: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: Date | string;
  gmina: { name: string };
  author: { name: string | null; organization: { name: string } | null } | null;
  // "Zapotrzebowanie na zasoby" (R11) shown right in the marker popup — same
  // data AlertNeedsBlock renders on the full card, just condensed.
  needs: Array<{
    id: string;
    title: string;
    quantityNeeded: number;
    quantityFulfilled: number;
    unit: string;
    urgency: string;
  }>;
}

interface AlertMapProps {
  alerts: MapAlert[];
  center: [number, number];
  height?: string;
  focusedAlertId?: string | null;
  onMapClick?: (lat: number, lng: number) => void;
  mode: MapDisplayMode;
  onModeChange: (mode: MapDisplayMode) => void;
  kind: AlertKindValue;
  // Opens the matching card in the list below the map (AlertsMapView) —
  // the reverse direction of "Pokaż na mapie" on that card.
  onGoToCard?: (alertId: string) => void;
}

function markerColor(alert: MapAlert, mode: MapDisplayMode, kind: AlertKindValue) {
  // Zdarzenia codzienne zawsze kolorujemy wg typu wydarzenia — krytyczność ich
  // nie dotyczy, więc przełącznik trybu w tym widoku nie jest pokazywany.
  if (kind === 'EVENT' || mode === 'category') {
    return CATEGORY_MARKER_COLORS[alert.category] ?? CATEGORY_MARKER_COLORS.GENERAL;
  }
  return SEVERITY_MARKER_COLORS[alert.severity] ?? SEVERITY_MARKER_COLORS.LOW;
}

function formatDate(value: Date | string) {
  try {
    return new Date(value).toLocaleString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

// Leaflet nie renderuje wewnątrz zwykłego drzewa Reacta w sposób, który
// pozwoliłby użyć hooków bezpośrednio w komponencie strony — te "niewidzialne"
// komponenty-dzieci istnieją tylko po to, by podpiąć się pod zdarzenia mapy
// (useMap/useMapEvents działają wyłącznie wewnątrz MapContainer).
function FocusController({ alerts, focusedAlertId }: { alerts: MapAlert[]; focusedAlertId?: string | null }) {
  const map = useMap();

  useEffect(() => {
    if (!focusedAlertId) return;
    const alert = alerts.find((a) => a.id === focusedAlertId);
    if (alert?.latitude != null && alert?.longitude != null) {
      map.flyTo([alert.latitude, alert.longitude], 14, { duration: 0.75 });
    }
  }, [focusedAlertId, alerts, map]);

  return null;
}

// Dopasowuje widok mapy do wszystkich widocznych markerów, ale tylko dopóki
// żaden alert nie jest wybrany do ręcznego dolotu (FocusController powyżej).
function FitBoundsToMarkers({ positions, disabled }: { positions: [number, number][]; disabled: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (disabled || positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], Math.max(map.getZoom(), 13));
      return;
    }
    map.fitBounds(L.latLngBounds(positions), { padding: [50, 50], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, disabled, map]);

  return null;
}

function ClickHandler({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function AlertMap({
  alerts,
  center,
  height = '480px',
  focusedAlertId,
  onMapClick,
  mode,
  onModeChange,
  kind,
  onGoToCard,
}: AlertMapProps) {
  const isEventView = kind === 'EVENT';
  // W widoku zdarzeń legenda zawsze pokazuje typy wydarzeń; w widoku alertów
  // zależy od wybranego trybu.
  const legendMode: MapDisplayMode = isEventView ? 'category' : mode;
  const withCoords = useMemo(
    () =>
      alerts.filter(
        (a): a is MapAlert & { latitude: number; longitude: number } => a.latitude != null && a.longitude != null
      ),
    [alerts]
  );

  const positions = useMemo<[number, number][]>(
    () => withCoords.map((a) => [a.latitude, a.longitude]),
    [withCoords]
  );

  return (
    <div className="relative w-full rounded-3xl overflow-hidden border border-slate-200 bg-white">
      {/* Przełącznik trybu wizualizacji (kategoria / krytyczność) — tylko dla
          komunikatów kryzysowych, bo zdarzenia codzienne nie mają krytyczności. */}
      {!isEventView && (
        <div className="absolute top-3 right-3 z-[1000] rounded-2xl bg-white/90 p-1.5 shadow-lg backdrop-blur-md border border-slate-200/80 text-xs flex items-center gap-1">
          <button
            type="button"
            onClick={() => onModeChange('category')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition text-xs ${
              mode === 'category' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            }`}
            title="Widok według kategorii zdarzenia"
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Kategorie</span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange('severity')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition text-xs ${
              mode === 'severity' ? 'bg-red-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            }`}
            title="Widok według krytyczności zdarzenia"
          >
            <Flame className="h-3.5 w-3.5" />
            <span>Krytyczność</span>
          </button>
        </div>
      )}

      <MapContainer center={center} zoom={11} style={{ height, width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitBoundsToMarkers positions={positions} disabled={!!focusedAlertId} />
        <FocusController alerts={withCoords} focusedAlertId={focusedAlertId} />
        {onMapClick && <ClickHandler onMapClick={onMapClick} />}

        {withCoords.map((alert) => {
          const color = markerColor(alert, mode, kind);
          return (
            <Marker
              key={`${alert.id}-${mode}-${kind}`}
              position={[alert.latitude, alert.longitude]}
              icon={isEventView ? createEventPinIcon(color) : createPinIcon(color)}
            >
              <Popup>
                <div className="min-w-[220px] max-w-xs space-y-2.5">
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2">
                    {!isEventView && (
                      <span
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border"
                        style={{
                          backgroundColor: hexToRgba(SEVERITY_MARKER_COLORS[alert.severity] ?? SEVERITY_MARKER_COLORS.LOW, 0.18),
                          color: SEVERITY_MARKER_COLORS[alert.severity] ?? SEVERITY_MARKER_COLORS.LOW,
                          borderColor: hexToRgba(SEVERITY_MARKER_COLORS[alert.severity] ?? SEVERITY_MARKER_COLORS.LOW, 0.4),
                        }}
                      >
                        {SEVERITY_LABELS[alert.severity] ?? alert.severity}
                      </span>
                    )}
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border"
                      style={{
                        backgroundColor: hexToRgba(CATEGORY_MARKER_COLORS[alert.category] ?? CATEGORY_MARKER_COLORS.GENERAL, 0.18),
                        color: CATEGORY_MARKER_COLORS[alert.category] ?? CATEGORY_MARKER_COLORS.GENERAL,
                        borderColor: hexToRgba(CATEGORY_MARKER_COLORS[alert.category] ?? CATEGORY_MARKER_COLORS.GENERAL, 0.4),
                      }}
                    >
                      {ALERT_CATEGORY_LABELS[alert.category] ?? alert.category}
                    </span>
                    <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {ALERT_STATUS_LABELS[alert.status] ?? alert.status}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <h4 className="text-sm font-extrabold text-slate-900 leading-tight">{alert.title}</h4>
                    <p className="text-xs text-slate-600 leading-snug">{alert.description}</p>
                  </div>

                  <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 text-red-500 shrink-0" />
                      <span className="truncate">
                        {alert.gmina.name}
                        {alert.location ? ` · ${alert.location}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Building className="h-3 w-3 text-slate-400 shrink-0" />
                      <span className="truncate">{alert.author?.organization?.name || alert.author?.name || 'Służby'}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3 text-slate-400 shrink-0" />
                      <time>{formatDate(alert.createdAt)}</time>
                    </div>
                  </div>

                  {alert.needs.length > 0 && (
                    <div className="pt-2 border-t border-slate-100 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                          Zapotrzebowanie na zasoby
                        </p>
                        {alert.needs.some((n) => n.urgency === 'PILNE' || n.urgency === 'KRYTYCZNY') && (
                          <span className="shrink-0 text-[10px] font-extrabold uppercase text-red-600">
                            Pilne żądania
                          </span>
                        )}
                      </div>
                      <ul className="space-y-1">
                        {alert.needs.map((need) => (
                          <li key={need.id} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="flex items-center gap-1.5 min-w-0 text-slate-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                              <span className="truncate">{need.title}</span>
                            </span>
                            <span className="shrink-0 font-bold text-slate-900">
                              {need.quantityFulfilled} / {need.quantityNeeded} {need.unit}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {onGoToCard && (
                    <button
                      type="button"
                      onClick={() => onGoToCard(alert.id)}
                      className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold py-1.5 transition"
                    >
                      Przejdź do kartki zdarzenia
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Legenda mapy, zależna od aktywnego trybu wizualizacji */}
      <div className="absolute bottom-3 left-3 z-[1000] rounded-2xl bg-white/90 p-3 shadow-lg backdrop-blur-md border border-slate-200/80 text-[11px] text-slate-600 hidden sm:block max-w-xs">
        <p className="font-bold text-slate-900 mb-1.5">
          {isEventView
            ? `Legenda: Typy wydarzeń (${withCoords.length})`
            : legendMode === 'category'
            ? `Legenda: Kategorie (${withCoords.length})`
            : `Legenda: Krytyczność (${withCoords.length})`}
        </p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {(isEventView ? EVENT_CATEGORIES : legendMode === 'category' ? ALERT_CATEGORIES : SEVERITIES).map((key) => {
            const color = legendMode === 'category' ? CATEGORY_MARKER_COLORS[key] : SEVERITY_MARKER_COLORS[key];
            const label = legendMode === 'category' ? ALERT_CATEGORY_LABELS[key] : SEVERITY_LABELS[key];
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span>{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
