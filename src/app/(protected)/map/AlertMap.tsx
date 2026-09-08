'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import { CATEGORY_MARKER_COLORS, ALERT_STATUS_LABELS, ALERT_CATEGORY_LABELS } from '@/lib/alertLabels';
import { createPinIcon } from './pinIcon';
import 'leaflet/dist/leaflet.css';
import './leaflet-dark.css';

export interface MapAlert {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  category: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface AlertMapProps {
  alerts: MapAlert[];
  center: [number, number];
  focusedAlertId?: string | null;
  onMapClick?: (lat: number, lng: number) => void;
}

// Leaflet nie renderuje wewnątrz zwykłego drzewa Reacta w sposób, który
// pozwoliłby użyć hooków bezpośrednio w komponencie strony — te dwa
// "niewidzialne" komponenty-dzieci istnieją tylko po to, by podpiąć się pod
// zdarzenia mapy (useMap/useMapEvents działają wyłącznie wewnątrz MapContainer).
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

function ClickHandler({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function AlertMap({ alerts, center, focusedAlertId, onMapClick }: AlertMapProps) {
  const withCoords = alerts.filter(
    (a): a is MapAlert & { latitude: number; longitude: number } => a.latitude != null && a.longitude != null
  );

  return (
    <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {withCoords.map((alert) => {
        const color = CATEGORY_MARKER_COLORS[alert.category] ?? CATEGORY_MARKER_COLORS.GENERAL;
        return (
          <Marker key={alert.id} position={[alert.latitude, alert.longitude]} icon={createPinIcon(color)}>
            <Popup>
              <p className="text-[10px] uppercase tracking-wide opacity-70">
                {ALERT_CATEGORY_LABELS[alert.category] ?? alert.category}
              </p>
              <p className="font-semibold text-sm">{alert.title}</p>
              <p className="text-xs mt-1">{alert.description}</p>
              <p className="text-xs mt-1 opacity-80">
                {ALERT_STATUS_LABELS[alert.status] ?? alert.status}
                {alert.location ? ` · ${alert.location}` : ''}
              </p>
            </Popup>
          </Marker>
        );
      })}
      <FocusController alerts={alerts} focusedAlertId={focusedAlertId} />
      {onMapClick && <ClickHandler onMapClick={onMapClick} />}
    </MapContainer>
  );
}
