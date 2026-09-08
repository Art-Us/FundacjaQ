'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import { createPinIcon } from './pinIcon';
import 'leaflet/dist/leaflet.css';
import './leaflet-dark.css';

interface LocationPickerProps {
  center: [number, number];
  value: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void;
  color: string;
}

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Leci do nowo wybranego punktu tylko gdy się zmienia (np. po kliknięciu
// przycisku GPS) — kliknięcie bezpośrednio na mapie już jest widoczne w
// bieżącym kadrze, więc dodatkowy flyTo tylko by przeszkadzał.
function FlyToValue({ value }: { value: { lat: number; lng: number } | null }) {
  const map = useMap();

  useEffect(() => {
    if (!value) return;
    map.flyTo([value.lat, value.lng], Math.max(map.getZoom(), 15), { duration: 0.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  return null;
}

export default function LocationPicker({ center, value, onPick, color }: LocationPickerProps) {
  function handleGps() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => onPick(pos.coords.latitude, pos.coords.longitude),
      () => {
        // Cichy fallback — brak zgody/lokalizacji nie blokuje ręcznego kliknięcia na mapie.
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  return (
    <div className="relative rounded-lg overflow-hidden border border-gray-300" style={{ height: 260 }}>
      <MapContainer
        className="map-light"
        center={value ? [value.lat, value.lng] : center}
        zoom={14}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {value && <Marker position={[value.lat, value.lng]} icon={createPinIcon(color, 40)} />}
        <ClickHandler onPick={onPick} />
        <FlyToValue value={value} />
      </MapContainer>
      <button
        type="button"
        onClick={handleGps}
        className="absolute top-2 right-2 z-[1000] rounded-lg border border-gray-300 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm backdrop-blur hover:bg-gray-50 transition-colors"
      >
        📍 Mój GPS
      </button>
    </div>
  );
}
