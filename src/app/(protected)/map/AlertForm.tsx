'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { BellRing, CalendarDays, LoaderCircle, MapPin, SearchX, Send } from 'lucide-react';
import {
  SEVERITY_LABELS,
  ALERT_CATEGORY_LABELS,
  SEVERITY_MARKER_COLORS,
  CATEGORY_MARKER_COLORS,
  DEFAULT_CATEGORY_FOR_KIND,
  categoriesForKind,
} from '@/lib/alertLabels';
import type { AlertKindValue } from '@/lib/alertLabels';
import { NOWA_DEBA_CENTER } from '@/lib/mapDefaults';
import type { Role } from '@/types';
import type { GminaOption } from './AlertsMapView';

const LocationPicker = dynamic(() => import('./LocationPicker'), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-sm text-slate-400"
      style={{ height: 260 }}
    >
      Ładowanie mapy…
    </div>
  ),
});

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

type GeoState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'found'; label: string }
  | { status: 'notfound' };

const INPUT_CLASS =
  'rounded-xl border border-slate-700 bg-slate-800 text-slate-100 text-xs sm:text-sm px-3.5 py-2.5 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20';
const LABEL_CLASS = 'text-xs font-semibold uppercase tracking-wide text-slate-400';

interface AlertFormProps {
  gminy: GminaOption[];
  currentUserGminaId: string | null;
  currentUserRole: Role;
  initialCoords: { lat: number; lng: number } | null;
  kind: AlertKindValue;
  onDone: () => void;
}

export default function AlertForm({
  gminy,
  currentUserGminaId,
  currentUserRole,
  initialCoords,
  kind,
  onDone,
}: AlertFormProps) {
  const router = useRouter();
  const isEvent = kind === 'EVENT';
  const categoryOptions = categoriesForKind(kind);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('MEDIUM');
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY_FOR_KIND[kind]);
  const [location, setLocation] = useState('');
  const [gminaId, setGminaId] = useState(currentUserGminaId ?? gminy[0]?.id ?? '');
  const [coords, setCoords] = useState(initialCoords);
  const [latText, setLatText] = useState(initialCoords ? String(initialCoords.lat) : '');
  const [lngText, setLngText] = useState(initialCoords ? String(initialCoords.lng) : '');
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Jeden timer i jeden licznik dla OBU kierunków geokodowania: nowe żądanie
  // anuluje poprzednie niezależnie od tego, czy przyszło z kliknięcia w mapę,
  // czy z wpisywania adresu, a `seq` odrzuca spóźnione odpowiedzi, które
  // inaczej nadpisałyby świeższy wynik.
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geocodeSeq = useRef(0);

  // COORDINATOR może tworzyć alerty tylko dla swojej gminy — pole i tak jest
  // wymuszone po stronie API, ale ukrywamy wybór w UI, żeby nie sugerować
  // czegoś, czego serwer i tak nie pozwoli zrobić.
  const gminaLocked = currentUserRole !== 'ADMIN';

  const selectedGmina = gminy.find((g) => g.id === gminaId);
  const pickerCenter: [number, number] =
    selectedGmina?.latitude != null && selectedGmina?.longitude != null
      ? [selectedGmina.latitude, selectedGmina.longitude]
      : NOWA_DEBA_CENTER;
  // Alert: pinezka wg krytyczności. Zdarzenie codzienne: wg typu wydarzenia —
  // tak samo jak markery na mapie, żeby podgląd zgadzał się z tym, co pojawi
  // się po zapisaniu.
  const pinColor = isEvent
    ? CATEGORY_MARKER_COLORS[category] ?? CATEGORY_MARKER_COLORS.OTHER_EVENT
    : SEVERITY_MARKER_COLORS[severity] ?? SEVERITY_MARKER_COLORS.MEDIUM;

  // Debounce zamiast wywołania na każde zdarzenie — respektuje limit 1
  // żądanie/s po stronie serwera (patrz geocodeLimiter) i nie zasypuje
  // Nominatim przy szybkim klikaniu czy pisaniu.
  function scheduleGeocode(run: (seq: number) => Promise<void>, delay: number) {
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    const seq = ++geocodeSeq.current;
    setGeo({ status: 'searching' });
    geocodeTimer.current = setTimeout(() => {
      void run(seq);
    }, delay);
  }

  // Kierunek 1: klik na mapie → współrzędne są znane, dopisujemy adres.
  function handlePick(lat: number, lng: number) {
    setCoords({ lat, lng });
    setLatText(String(lat));
    setLngText(String(lng));

    scheduleGeocode(async (seq) => {
      try {
        const res = await fetch(`/api/geocode/reverse?lat=${lat}&lon=${lng}`);
        if (seq !== geocodeSeq.current) return;
        if (!res.ok) {
          setGeo({ status: 'notfound' });
          return;
        }
        const data = await res.json();
        if (seq !== geocodeSeq.current) return;
        // Tu nadpisanie pola adresu jest pożądane — użytkownik nie pisze,
        // tylko wskazał punkt i oczekuje podpowiedzi.
        if (data.location) setLocation(data.location);
        setGeo(data.label ? { status: 'found', label: data.label } : { status: 'notfound' });
      } catch {
        // Brak automatycznego rozpoznania nie blokuje ręcznego wpisania lokalizacji.
        if (seq === geocodeSeq.current) setGeo({ status: 'notfound' });
      }
    }, 600);
  }

  // Kierunek 2: wpisany adres → szukamy współrzędnych i przesuwamy pinezkę.
  function handleLocationChange(value: string) {
    setLocation(value);

    const query = value.trim();
    if (query.length < 3) {
      if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
      geocodeSeq.current += 1; // unieważnia ewentualną odpowiedź w locie
      setGeo({ status: 'idle' });
      return;
    }

    scheduleGeocode(async (seq) => {
      try {
        const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}`);
        if (seq !== geocodeSeq.current) return;
        if (!res.ok) {
          setGeo({ status: 'notfound' });
          return;
        }
        const data = await res.json();
        if (seq !== geocodeSeq.current) return;
        if (!data.found) {
          setGeo({ status: 'notfound' });
          return;
        }
        // Celowo NIE ruszamy pola adresu — użytkownik w nim pisze, a podmiana
        // tekstu pod kursorem przerywałaby wpisywanie.
        setCoords({ lat: data.lat, lng: data.lon });
        setGeo(data.label ? { status: 'found', label: data.label } : { status: 'idle' });
      } catch {
        if (seq === geocodeSeq.current) setGeo({ status: 'notfound' });
      }
    }, 800);
  }

  // Ręczna edycja współrzędnych — użytkownik może wkleić dokładne dane zamiast
  // (albo obok) klikania na mapie. Puste/nieliczbowe pole nie przesuwa pinezki,
  // dopóki obie osie nie będą poprawnymi liczbami.
  function handleLatChange(text: string) {
    setLatText(text);
    const lat = parseFloat(text);
    if (!Number.isFinite(lat)) return;
    setCoords((prev) => ({ lat, lng: prev?.lng ?? pickerCenter[1] }));
  }

  function handleLngChange(text: string) {
    setLngText(text);
    const lng = parseFloat(text);
    if (!Number.isFinite(lng)) return;
    setCoords((prev) => ({ lat: prev?.lat ?? pickerCenter[0], lng }));
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
        kind,
        // Zdarzenia codzienne nie mają krytyczności — API użyje wartości domyślnej.
        ...(isEvent ? {} : { severity }),
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
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-xs flex flex-col gap-5"
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
            isEvent ? 'bg-fuchsia-950/60 text-fuchsia-400' : 'bg-indigo-950/60 text-indigo-400'
          }`}
        >
          {isEvent ? <CalendarDays className="h-5 w-5" /> : <BellRing className="h-5 w-5" />}
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-100">
            {isEvent ? 'Dodaj nowe zdarzenie codzienne' : 'Opublikuj nowy komunikat kryzysowy'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {isEvent
              ? 'Festyn, koncert, zebranie mieszkańców — kliknij punkt na mapie, nazwa miejscowości zostanie wykryta automatycznie.'
              : 'Kliknij punkt na mapie — nazwa miejscowości zostanie wykryta automatycznie.'}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className={LABEL_CLASS}>{isEvent ? 'Typ wydarzenia' : 'Kategoria zdarzenia'}</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT_CLASS}>
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>
                    {ALERT_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>
            {!isEvent && (
              <div className="flex flex-col gap-1.5">
                <label className={LABEL_CLASS}>Krytyczność zdarzenia (Alarm)</label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as typeof severity)}
                  className={`${INPUT_CLASS} font-bold`}
                >
                  {SEVERITIES.map((sev) => (
                    <option key={sev} value={sev}>
                      {SEVERITY_LABELS[sev]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={LABEL_CLASS}>{isEvent ? 'Nazwa wydarzenia' : 'Tytuł / Nazwa zdarzenia'}</label>
            <input
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                isEvent
                  ? 'np. Dni Nowej Dęby, Koncert na rynku, Zebranie osiedlowe...'
                  : 'np. Fala wezbraniowa na rzece, Zamknięcie mostu drogowego...'
              }
              className={`${INPUT_CLASS} font-bold placeholder:font-normal placeholder-slate-500`}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={LABEL_CLASS}>{isEvent ? 'Opis wydarzenia' : 'Treść komunikatu'}</label>
            <textarea
              required
              maxLength={2000}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                isEvent
                  ? 'Godziny, program, organizator, dla kogo jest wydarzenie...'
                  : 'Wprowadź szczegółowe informacje operacyjne (zalecenia dla mieszkańców, wyznaczone objazdy, punkty pomocy)...'
              }
              className={`${INPUT_CLASS} resize-none placeholder-slate-500`}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className={LABEL_CLASS}>Adres / lokalizacja</label>
              <input
                maxLength={200}
                value={location}
                onChange={(e) => handleLocationChange(e.target.value)}
                placeholder="np. ul. Sportowa 3"
                className={`${INPUT_CLASS} placeholder-slate-500`}
              />
              <span className="text-[11px] text-slate-500">
                Wpisz ulicę - punkt na mapie ustawi się automatycznie.
              </span>
            </div>
            {!gminaLocked && (
              <div className="flex flex-col gap-1.5">
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

        <div className="lg:col-span-5 flex flex-col gap-2">
          <label className={`${LABEL_CLASS} flex items-center gap-1.5`}>
            <MapPin className="h-3.5 w-3.5 text-indigo-400" />
            <span>{isEvent ? 'Wskaż miejsce wydarzenia (kliknij na mapie)' : 'Wskaż punkt zdarzenia (kliknij na mapie)'}</span>
          </label>
          <LocationPicker
            center={pickerCenter}
            value={coords}
            onPick={handlePick}
            color={pinColor}
            icon={isEvent ? 'event' : 'alert'}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Szerokość (lat)
              </label>
              <input
                type="number"
                step="any"
                value={latText}
                onChange={(e) => handleLatChange(e.target.value)}
                placeholder="np. 50.4380"
                className={`${INPUT_CLASS} font-mono text-xs py-1.5`}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Długość (lng)
              </label>
              <input
                type="number"
                step="any"
                value={lngText}
                onChange={(e) => handleLngChange(e.target.value)}
                placeholder="np. 21.7500"
                className={`${INPUT_CLASS} font-mono text-xs py-1.5`}
              />
            </div>
          </div>
          {!coords && (
            <p className="text-xs text-slate-500">
              Kliknij punkt na mapie albo wpisz współrzędne ręcznie.
            </p>
          )}

          {geo.status !== 'idle' && (
            <div
              className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
                geo.status === 'found'
                  ? 'border-emerald-900/70 bg-emerald-950/40'
                  : geo.status === 'searching'
                  ? 'border-slate-700 bg-slate-800/60'
                  : 'border-amber-900/60 bg-amber-950/30'
              }`}
            >
              {geo.status === 'searching' ? (
                <LoaderCircle className="h-4 w-4 mt-px shrink-0 animate-spin text-slate-400" />
              ) : geo.status === 'found' ? (
                <MapPin className="h-4 w-4 mt-px shrink-0 text-emerald-400" />
              ) : (
                <SearchX className="h-4 w-4 mt-px shrink-0 text-amber-400" />
              )}

              <div className="min-w-0 space-y-0.5">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {geo.status === 'searching'
                    ? 'Rozpoznawanie lokalizacji…'
                    : geo.status === 'found'
                    ? 'Wykryta lokalizacja'
                    : 'Nie rozpoznano adresu'}
                </span>
                {geo.status === 'found' && (
                  <span className="block text-xs font-semibold text-emerald-200 break-words">{geo.label}</span>
                )}
                {geo.status === 'notfound' && (
                  <span className="block text-xs text-slate-400">
                    Uściślij adres lub wskaż punkt na mapie.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {message && <p className="text-sm text-rose-400">{message}</p>}

      <div className="flex justify-end pt-2 border-t border-slate-800">
        <button
          type="submit"
          disabled={loading}
          className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-8 py-3 text-xs font-bold text-white shadow-sm shadow-indigo-600/25 disabled:opacity-50 transition transform active:scale-95"
        >
          {loading ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>{isEvent ? 'Dodawanie...' : 'Publikowanie...'}</span>
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              <span>{isEvent ? 'Dodaj zdarzenie na mapie' : 'Opublikuj alert na mapie'}</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
