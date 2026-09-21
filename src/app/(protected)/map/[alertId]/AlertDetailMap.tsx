'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { MapAlert, MapDisplayMode } from '../AlertMap';
import type { AlertKindValue } from '@/lib/alertLabels';

// Same ssr:false dynamic import AlertsMapView.tsx uses — Leaflet touches
// `window` at module load time and breaks server-side rendering otherwise.
const AlertMap = dynamic(() => import('../AlertMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-500">Ładowanie mapy…</div>
  ),
});

interface AlertDetailMapProps {
  alert: MapAlert;
  kind: AlertKindValue;
}

// Thin client wrapper around AlertMap for a single alert's detail page — the
// only reason this isn't inlined directly into the (server) page.tsx is that
// AlertMap's category/severity toggle needs a bit of client-side state
// (`mode`) to control which button looks active; page.tsx itself stays a
// plain server component otherwise.
export default function AlertDetailMap({ alert, kind }: AlertDetailMapProps) {
  const [mode, setMode] = useState<MapDisplayMode>('category');
  const center: [number, number] =
    alert.latitude != null && alert.longitude != null ? [alert.latitude, alert.longitude] : [50.448, 21.75];

  return (
    <AlertMap alerts={[alert]} center={center} height="360px" mode={mode} onModeChange={setMode} kind={kind} />
  );
}
