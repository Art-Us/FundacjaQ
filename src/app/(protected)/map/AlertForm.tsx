'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { SEVERITY_LABELS, ALERT_CATEGORY_LABELS, CATEGORY_MARKER_COLORS } from '@/lib/alertLabels';
import { NOWA_DEBA_CENTER } from '@/lib/mapDefaults';
import type { Role } from '@/types';
import type { GminaOption } from './AlertsMapView';

const LocationPicker = dynamic(() => import('./LocationPicker'), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center rounded-lg border border-gray-300 bg-gray-50 text-sm text-gray-400"
      style={{ height: 260 }}
    >
      Ładowanie mapy…
    </div>
  ),
});

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
const CATEGORIES = ['HYDROLOGICAL', 'ROAD', 'HUMANITARIAN', 'FIRE', 'INFRASTRUCTURE', 'GENERAL'] as const;

const INPUT_CLASS =
  'rounded-lg border border-gray-300 bg-white text-gray-900 text-sm px-3 py-2 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30';
const LABEL_CLASS = 'text-xs font-semibold uppercase tracking-wide text-gray-500';

interface AlertFormProps {
  gminy: GminaOption[];
  currentUserGminaId: string | null;
  currentUserRole: Role;
  initialCoords: { lat: number; lng: number } | null;
  onDone: () => void;
}

export default function AlertForm({
  gminy,
  currentUserGminaId,
  currentUserRole,
  initialCoords,
  onDone,
}: AlertFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('MEDIUM');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('GENERAL');
  const [location, setLocation] = useState('');
  const [gminaId, setGminaId] = useState(currentUserGminaId ?? gminy[0]?.id ?? '');
  const [coords, setCoords] = useState(initialCoords);
  const [geoBadge, setGeoBadge] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // COORDINATOR może tworzyć alerty tylko dla swojej gminy — pole i tak jest
  // wymuszone po stronie API, ale ukrywamy wybór w UI, żeby nie sugerować
  // czegoś, czego serwer i tak nie pozwoli zrobić.
  const gminaLocked = currentUserRole !== 'ADMIN';

  const selectedGmina = gminy.find((g) => g.id === gminaId);
  const pickerCenter: [number, number] =
    selectedGmina?.latitude != null && selectedGmina?.longitude != null
      ? [selectedGmina.latitude, selectedGmina.longitude]
      : NOWA_DEBA_CENTER;
  const pinColor = CATEGORY_MARKER_COLORS[category] ?? CATEGORY_MARKER_COLORS.GENERAL;

  // Debounce zamiast wywołania na każdym kliknięciu — respektuje limit 1
  // żądanie/s po stronie serwera (patrz geocodeLimiter) i nie zasypuje
  // Nominatim przy szybkich, powtarzanych kliknięciach.
  function handlePick(lat: number, lng: number) {
    setCoords({ lat, lng });
    setGeoBadge(null);

    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode/reverse?lat=${lat}&lon=${lng}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.location) setLocation(data.location);
        if (data.town) {
          setGeoBadge(`Wykryto z mapy: ${data.town}${data.state ? ` (woj. ${data.state})` : ''}`);
        }
      } catch {
        // Brak automatycznego rozpoznania nie blokuje ręcznego wpisania lokalizacji.
      }
    }, 600);
  }

  useEffect(() => {
    return () => {
      if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!coords) {
      setMessage('Wskaż lokalizację zdarzenia na mapie poniżej.');
      return;
    }

    setLoading(true);
    setMessage(null);

    const res = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        severity,
        category,
        location: location || undefined,
        latitude: coords.lat,
        longitude: coords.lng,
        gminaId,
      }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setMessage(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-lg">
          🔔
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">Opublikuj nowy komunikat kryzysowy</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Kliknij punkt na mapie — nazwa miejscowości, powiat i województwo zostaną wykryte automatycznie.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className={LABEL_CLASS}>Kategoria zdarzenia</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className={INPUT_CLASS}>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {ALERT_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={LABEL_CLASS}>Krytyczność</label>
              <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} className={INPUT_CLASS}>
                {SEVERITIES.map((sev) => (
                  <option key={sev} value={sev}>
                    {SEVERITY_LABELS[sev]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className={LABEL_CLASS}>Tytuł</label>
            <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT_CLASS} />
          </div>

          <div className="flex flex-col gap-1">
            <label className={LABEL_CLASS}>Opis</label>
            <textarea
              required
              maxLength={2000}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className={LABEL_CLASS}>Lokalizacja (opcjonalnie)</label>
              <input
                maxLength={200}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="np. ul. Rzeczna"
                className={INPUT_CLASS}
              />
            </div>
            {!gminaLocked && (
              <div className="flex flex-col gap-1">
                <label className={LABEL_CLASS}>Gmina</label>
                <select value={gminaId} onChange={(e) => setGminaId(e.target.value)} className={INPUT_CLASS}>
                  {gminy.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={LABEL_CLASS}>Wskaż punkt zdarzenia (kliknij na mapie)</label>
          <LocationPicker center={pickerCenter} value={coords} onPick={handlePick} color={pinColor} />
          <p className="text-xs text-gray-500">
            {coords
              ? `Wybrana lokalizacja: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`
              : 'Kliknij na mapie lub użyj przycisku „Mój GPS”.'}
          </p>
          {geoBadge && <p className="text-xs font-medium text-emerald-600">📍 {geoBadge}</p>}
        </div>
      </div>

      {message && <p className="text-sm text-red-600">{message}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none text-white text-sm font-medium px-4 py-2 transition-colors"
        >
          {loading ? 'Zapisywanie…' : 'Utwórz alert'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-gray-300 text-gray-600 hover:border-gray-400 text-sm px-4 py-2 transition-colors"
        >
          Anuluj
        </button>
      </div>
    </form>
  );
}
