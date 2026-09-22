'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import { createPinIcon, createEventPinIcon, createLocationPinIcon } from './pinIcon';
// Leaflet's own CSS + our theme overrides are imported once, in the root
// layout — see the comment in src/app/layout.tsx for why.

interface LocationPickerProps {
  center: [number, number];
  value: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void;
  color: string;
  // Podgląd pinezki musi używać tego samego glifu co docelowy marker na mapie
  // przeglądowej — trójkąt ostrzegawczy dla alertów, kalendarz dla zdarzeń,
  // zwykła kropla dla ogólnego wskazania punktu (np. siedziba gminy).
  icon?: 'alert' | 'event' | 'location';
}

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Wycentrowuje mapę na nowo wybranym punkcie — istotne głównie gdy `value`
// zostaje ustawione programowo (np. istniejąca lokalizacja przy edycji alertu),
// a nie tylko przez kliknięcie w widoczny już obszar mapy.
function FlyToValue({ value }: { value: { lat: number; lng: number } | null }) {
  const map = useMap();

  useEffect(() => {
    if (!value) return;
    map.flyTo([value.lat, value.lng], Math.max(map.getZoom(), 15), { duration: 0.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  return null;
}

export default function LocationPicker({ center, value, onPick, color, icon = 'alert' }: LocationPickerProps) {
  const markerIcon =
    icon === 'event'
      ? createEventPinIcon(color, 40)
      : icon === 'location'
        ? createLocationPinIcon(color, 40)
        : createPinIcon(color, 40);

  return (
    // `isolate` contains Leaflet's internal z-index (up to 1000 for its zoom
    // control) inside this box — see the same note in AlertMap.tsx.
    <div className="relative isolate rounded-lg overflow-hidden border border-gray-300" style={{ height: 260 }}>
      <MapContainer
        center={value ? [value.lat, value.lng] : center}
        zoom={14}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {value && <Marker position={[value.lat, value.lng]} icon={markerIcon} />}
        <ClickHandler onPick={onPick} />
        <FlyToValue value={value} />
      </MapContainer>
    </div>
  );
}
