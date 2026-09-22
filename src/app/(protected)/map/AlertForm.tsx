'use client';

import { useEffect, useRef, useState } from 'react';
import { dynamicClientOnly } from '@/lib/dynamicClientOnly';
import { useRouter } from 'next/navigation';
import { BellRing, CalendarDays, LoaderCircle, MapPin, Package, Plus, SearchX, Send, Trash2, X } from 'lucide-react';
import {
  SEVERITY_LABELS,
  ALERT_CATEGORY_LABELS,
  SEVERITY_MARKER_COLORS,
  CATEGORY_MARKER_COLORS,
  DEFAULT_CATEGORY_FOR_KIND,
  categoriesForKind,
} from '@/lib/alertLabels';
import type { AlertKindValue } from '@/lib/alertLabels';
import { getResourceGroupInfo, getNeedUrgencyInfo } from '@/lib/resourceLabels';
import type { MatrixCategoryRow, MatrixGroup } from '@/lib/resourceMatrix';
import { NOWA_DEBA_CENTER } from '@/lib/mapDefaults';
import type { Role } from '@/types';
import type { GminaOption } from './AlertsMapView';
import { apiFetch, apiSend } from '@/lib/apiClient';

const LocationPicker = dynamicClientOnly(() => import('./LocationPicker'), {
  loading: () => (
    <div
      className="flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-400"
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
  'rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-xs sm:text-sm px-3.5 py-2.5 outline-none transition-colors focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10';
const LABEL_CLASS = 'text-xs font-semibold uppercase tracking-wide text-slate-500';

const NEED_URGENCIES = ['NORMAL', 'PILNE', 'KRYTYCZNY'] as const;
const GROUP_ORDER: MatrixGroup[] = ['PEOPLE', 'WATER', 'EQUIPMENT', 'OTHER'];

// A "Zapotrzebowanie na zasoby" row filled in while creating the alert —
// always a brand-new AlertNeed (no `id`/quantityFulfilled, unlike
// NeedFormModal's NeedRow which also edits existing ones), POSTed to
// /api/alerts/[id]/needs right after the alert itself is created.
interface NeedDraftRow {
  key: string;
  categoryId: string;
  title: string;
  quantityNeeded: string;
  unit: string;
  urgency: (typeof NEED_URGENCIES)[number];
}

let needRowSeq = 0;
function emptyNeedRow(defaultCategoryId: string): NeedDraftRow {
  needRowSeq += 1;
  return { key: `need-${needRowSeq}`, categoryId: defaultCategoryId, title: '', quantityNeeded: '', unit: 'szt', urgency: 'NORMAL' };
}

// A row the reporter never touched (still fully at its default) is silently
// dropped on submit rather than forcing them to either fill it in or
// explicitly delete it — only a PARTIALLY filled row blocks submission.
function isNeedRowEmpty(row: NeedDraftRow): boolean {
  return !row.title.trim() && row.quantityNeeded.trim() === '';
}

function isNeedRowValid(row: NeedDraftRow): boolean {
  return !!row.categoryId && row.title.trim().length > 0 && Number(row.quantityNeeded) >= 1;
}

interface AlertFormProps {
  gminy: GminaOption[];
  currentUserGminaId: string | null;
  currentUserRole: Role;
  initialCoords: { lat: number; lng: number } | null;
  kind: AlertKindValue;
  onDone: () => void;
  // Collapses the form back to the "+ Opublikuj..." button without
  // submitting — distinct from onDone (which also router.refresh()es after a
  // successful POST).
  onCancel: () => void;
}

export default function AlertForm({
  gminy,
  currentUserGminaId,
  currentUserRole,
  initialCoords,
  kind,
  onDone,
  onCancel,
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
  const [startsAt, setStartsAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [needCategories, setNeedCategories] = useState<MatrixCategoryRow[] | null>(null);
  const [needCategoriesError, setNeedCategoriesError] = useState<string | null>(null);
  const [needRows, setNeedRows] = useState<NeedDraftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Set once POST /api/alerts succeeds — guards against a second click on the
  // submit button re-creating a second alert while the form stays open (only
  // happens if some of the need rows below failed to save; see handleSubmit).
  const [createdAlertId, setCreatedAlertId] = useState<string | null>(null);
  // Jeden timer i jeden licznik dla OBU kierunków geokodowania: nowe żądanie
  // anuluje poprzednie niezależnie od tego, czy przyszło z kliknięcia w mapę,
  // czy z wpisywania adresu, a `seq` odrzuca spóźnione odpowiedzi, które
  // inaczej nadpisałyby świeższy wynik.
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geocodeSeq = useRef(0);

  // COORDINATOR i administrator gminy (ADMIN z ustawioną gminaId) mogą
  // tworzyć alerty tylko dla swojej gminy — pole i tak jest wymuszone po
  // stronie API (isAdminForGmina, POST /api/alerts), ale ukrywamy wybór w
  // UI, żeby nie sugerować czegoś, czego serwer i tak nie pozwoli zrobić.
  // Tylko globalny ADMIN (bez własnej gminy) widzi otwartą listę.
  const gminaLocked = currentUserRole !== 'ADMIN' || !!currentUserGminaId;

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

  // Self-fetched, same pattern NeedFormModal.tsx uses for its own TYP
  // dropdown — no server-component plumbing carries a category list into
  // this client form today, so this mirrors the existing convention rather
  // than inventing a new one.
  useEffect(() => {
    apiFetch<{ categories?: MatrixCategoryRow[] }>('/api/resources/matrix').then((result) => {
      if (!result.ok) {
        setNeedCategoriesError(result.error);
        return;
      }
      setNeedCategories(result.data.categories ?? []);
    });
  }, []);

  function addNeedRow() {
    setNeedRows((prev) => [...prev, emptyNeedRow(needCategories?.[0]?.categoryId ?? '')]);
  }

  function updateNeedRow(key: string, patch: Partial<NeedDraftRow>) {
    setNeedRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeNeedRow(key: string) {
    setNeedRows((prev) => prev.filter((row) => row.key !== key));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // The alert already exists (created on a previous submit) and only some
    // need rows failed to save — a second click just closes the form instead
    // of creating a duplicate alert.
    if (createdAlertId) {
      onDone();
      return;
    }

    if (!coords) {
      setMessage('Wskaż lokalizację zdarzenia na mapie poniżej.');
      return;
    }

    const filledNeedRows = needRows.filter((row) => !isNeedRowEmpty(row));
    const invalidNeedRow = filledNeedRows.find((row) => !isNeedRowValid(row));
    if (invalidNeedRow) {
      setMessage('Uzupełnij lub usuń niekompletną pozycję w "Zapotrzebowanie na zasoby".');
      return;
    }

    if (startsAt && expiresAt && new Date(startsAt) > new Date(expiresAt)) {
      setMessage('Data rozpoczęcia nie może być późniejsza niż data zakończenia.');
      return;
    }

    setLoading(true);
    setMessage(null);

    const created = await apiSend<{ alert: { id: string } }>('/api/alerts', 'POST', {
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
      ...(startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}),
      ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
    });

    if (!created.ok) {
      setLoading(false);
      setMessage(created.error);
      return;
    }

    const newAlertId = created.data.alert.id;
    setCreatedAlertId(newAlertId);

    const needFailures: string[] = [];
    for (const row of filledNeedRows) {
      const needResult = await apiSend(`/api/alerts/${newAlertId}/needs`, 'POST', {
        categoryId: row.categoryId,
        title: row.title.trim(),
        quantityNeeded: Number(row.quantityNeeded),
        unit: row.unit.trim() || 'szt',
        urgency: row.urgency,
      });
      if (!needResult.ok) {
        needFailures.push(`„${row.title.trim()}”: ${needResult.error}`);
      }
    }

    setLoading(false);
    router.refresh();

    if (needFailures.length > 0) {
      // Alert was created successfully — keep the form open only so this
      // message stays visible; createdAlertId above turns the submit button
      // into a plain "close", so it can't create a second alert.
      setMessage(
        `Alert utworzony, ale nie udało się dodać części zapotrzebowania: ${needFailures.join(' ')} Możesz je dodać później przez „Edytuj zapotrzebowanie”.`
      );
      return;
    }

    onDone();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs flex flex-col gap-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
              isEvent ? 'bg-fuchsia-50 text-fuchsia-600' : 'bg-indigo-50 text-indigo-600'
            }`}
          >
            {isEvent ? <CalendarDays className="h-5 w-5" /> : <BellRing className="h-5 w-5" />}
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {isEvent ? 'Dodaj nowe zdarzenie codzienne' : 'Opublikuj nowy komunikat kryzysowy'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEvent
                ? 'Festyn, koncert, zebranie mieszkańców — kliknij punkt na mapie, nazwa miejscowości zostanie wykryta automatycznie.'
                : 'Kliknij punkt na mapie — nazwa miejscowości zostanie wykryta automatycznie.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          title="Zamknij"
          className="shrink-0 rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
        >
          <X className="h-5 w-5" />
        </button>
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
              className={`${INPUT_CLASS} font-bold placeholder:font-normal placeholder-slate-400`}
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
              className={`${INPUT_CLASS} resize-none placeholder-slate-400`}
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
                className={`${INPUT_CLASS} placeholder-slate-400`}
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

          <div>
            <label className={`${LABEL_CLASS} block mb-1.5`}>
              Zakres czasowy {isEvent ? 'wydarzenia' : 'alertu'} (opcjonalnie)
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Aktywny od — puste znaczy "od teraz"
                </span>
                <input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Aktywny do — puste znaczy "do odwołania"
                </span>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Ten zakres decyduje o tym, w jakich filtrach czasowych ("Ostatnie 24h", "Tydzień"...) ten wpis się
              pojawi.
            </p>
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
                  ? 'border-emerald-200 bg-emerald-50'
                  : geo.status === 'searching'
                  ? 'border-slate-200 bg-slate-50'
                  : 'border-amber-200 bg-amber-50'
              }`}
            >
              {geo.status === 'searching' ? (
                <LoaderCircle className="h-4 w-4 mt-px shrink-0 animate-spin text-slate-400" />
              ) : geo.status === 'found' ? (
                <MapPin className="h-4 w-4 mt-px shrink-0 text-emerald-600" />
              ) : (
                <SearchX className="h-4 w-4 mt-px shrink-0 text-amber-600" />
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
                  <span className="block text-xs font-semibold text-emerald-700 break-words">{geo.label}</span>
                )}
                {geo.status === 'notfound' && (
                  <span className="block text-xs text-slate-500">
                    Uściślij adres lub wskaż punkt na mapie.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-100 pt-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
              <Package className="h-4 w-4 text-slate-500" />
              Zapotrzebowanie na zasoby (zapytania / potrzebne wsparcie)
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5 max-w-xl">
              Określ czego i w jakiej ilości potrzebują służby na miejscu zdarzenia (np. woda, agregaty, pompy,
              ratownicy). Inne jednostki będą mogły przydzielić swoje zasoby. Opcjonalne — możesz dodać to też
              później.
            </p>
          </div>
          <button
            type="button"
            onClick={addNeedRow}
            disabled={!needCategories || needCategories.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold border border-amber-300 transition disabled:opacity-50 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Dodaj zapotrzebowanie
          </button>
        </div>

        {needCategoriesError && <p className="text-xs text-rose-600">{needCategoriesError}</p>}

        {needRows.length > 0 && (
          <div className="space-y-3">
            {needRows.map((row) => (
              <div
                key={row.key}
                className="grid grid-cols-1 sm:grid-cols-[1.1fr_2fr_0.8fr_0.6fr_0.9fr_auto] gap-3 items-end rounded-2xl border border-slate-200 p-3"
              >
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Typ
                  </label>
                  <select
                    value={row.categoryId}
                    onChange={(e) => updateNeedRow(row.key, { categoryId: e.target.value })}
                    required
                    className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-2.5 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
                  >
                    {!needCategories && <option value="">Ładowanie…</option>}
                    {needCategories &&
                      GROUP_ORDER.map((group) => {
                        const inGroup = needCategories.filter((c) => c.group === group);
                        if (inGroup.length === 0) return null;
                        return (
                          <optgroup key={group} label={getResourceGroupInfo(group).label}>
                            {inGroup.map((c) => (
                              <option key={c.categoryId} value={c.categoryId}>
                                {c.name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Nazwa / opis zasobu
                  </label>
                  <input
                    type="text"
                    value={row.title}
                    onChange={(e) => updateNeedRow(row.key, { title: e.target.value })}
                    maxLength={200}
                    placeholder="np. Woda butelkowana 1.5L"
                    className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-2.5 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Potrzebna ilość
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={row.quantityNeeded}
                    onChange={(e) => updateNeedRow(row.key, { quantityNeeded: e.target.value })}
                    className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-2.5 text-slate-900 text-xs font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Jedn.
                  </label>
                  <input
                    type="text"
                    value={row.unit}
                    onChange={(e) => updateNeedRow(row.key, { unit: e.target.value })}
                    maxLength={20}
                    className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-2.5 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Pilność
                  </label>
                  <select
                    value={row.urgency}
                    onChange={(e) => updateNeedRow(row.key, { urgency: e.target.value as NeedDraftRow['urgency'] })}
                    className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-2.5 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
                  >
                    {NEED_URGENCIES.map((u) => (
                      <option key={u} value={u}>
                        {getNeedUrgencyInfo(u).label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => removeNeedRow(row.key)}
                  title="Usuń pozycję"
                  className="justify-self-end sm:justify-self-auto rounded-xl p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <p className="text-sm text-rose-600">{message}</p>}

      <div className="flex justify-end pt-2 border-t border-slate-100">
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
          ) : createdAlertId ? (
            <span>Zamknij</span>
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
