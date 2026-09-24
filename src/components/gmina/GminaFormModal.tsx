'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { dynamicClientOnly } from '@/lib/dynamicClientOnly';
import { X, LoaderCircle, MapPin, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBackdropDismiss } from '@/components/ui/useBackdropDismiss';
import { NOWA_DEBA_CENTER } from '@/lib/mapDefaults';
import { bareCounty, bareState } from '@/lib/geocode';

// dynamicClientOnly, not next/dynamic({ ssr: false }) — see its own doc
// comment: the Suspense wrapping next/dynamic adds around a lazy import
// turned a react-leaflet lifecycle bug into a crash that took down this
// whole modal (and the page behind it) instead of staying contained to the
// map widget. AlertForm/AlertEditModal/AlertsMapView already made this
// switch; this was the one spot that still hadn't.
const LocationPicker = dynamicClientOnly(() => import('@/app/(protected)/map/LocationPicker'), {
  loading: () => (
    <div
      className="flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-400"
      style={{ height: 220 }}
    >
      Ładowanie mapy…
    </div>
  ),
});

const inputClasses =
  'w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3.5 text-sm text-slate-900 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition';
const labelClasses = 'block text-xs font-bold text-slate-600 mb-1.5';

export interface GminaFormValue {
  id: string;
  name: string;
  powiat: string | null;
  voivodeship: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

type GeoState = { status: 'idle' | 'searching' | 'found' | 'notfound'; label?: string };

interface GminaFormModalProps {
  mode: 'create' | 'edit';
  gmina?: GminaFormValue;
  onClose: () => void;
  /** Called with the created/updated gmina right before onClose, once the API call succeeds. */
  onSuccess?: (gmina: { id: string; name: string }) => void;
}

export function GminaFormModal({ mode, gmina, onClose, onSuccess }: GminaFormModalProps) {
  const router = useRouter();
  const [name, setName] = useState(gmina?.name ?? '');
  const [powiat, setPowiat] = useState(gmina?.powiat ?? '');
  const [voivodeship, setVoivodeship] = useState(gmina?.voivodeship ?? '');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    gmina?.latitude != null && gmina?.longitude != null ? { lat: gmina.latitude, lng: gmina.longitude } : null
  );
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdropHandlers = useBackdropDismiss(onClose);

  // Jak w AlertForm: jeden licznik unieważnia odpowiedzi z poprzednich kliknięć,
  // gdyby użytkownik kliknął w mapę kilka razy zanim pierwsza odpowiedź wróci.
  const geocodeSeq = useRef(0);

  // Klik na mapie to alternatywny, szybszy sposób wypełnienia pól — celowo
  // nadpisuje nazwę/powiat/województwo, bo użytkownik właśnie wskazał punkt i
  // oczekuje podpowiedzi, a nie zachowania tego, co ewentualnie wpisał wcześniej.
  function handlePick(lat: number, lng: number) {
    setCoords({ lat, lng });
    setGeo({ status: 'searching' });
    const seq = ++geocodeSeq.current;

    void (async () => {
      try {
        const res = await fetch(`/api/geocode/reverse?lat=${lat}&lon=${lng}`);
        if (seq !== geocodeSeq.current) return;
        if (!res.ok) {
          setGeo({ status: 'notfound' });
          return;
        }
        const data = await res.json();
        if (seq !== geocodeSeq.current) return;

        if (data.town) setName(data.town);
        // Miasta na prawach powiatu (Tarnobrzeg, Rzeszów...) nie mają w
        // hierarchii Nominatim osobnego "county" — samo miasto JEST powiatem,
        // więc brak county nie znaczy "nie rozpoznano", tylko "to powiat grodzki".
        const powiatValue = bareCounty(data.county) ?? data.town ?? null;
        if (powiatValue) setPowiat(powiatValue);
        const voivodeshipValue = bareState(data.state);
        if (voivodeshipValue) setVoivodeship(voivodeshipValue);

        setGeo(data.label ? { status: 'found', label: data.label } : { status: 'notfound' });
      } catch {
        if (seq === geocodeSeq.current) setGeo({ status: 'notfound' });
      }
    })();
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // React re-bubbles synthetic events to ancestors in the *React* tree even
    // across a portal — when this modal is opened from GminaSelect nested in
    // another <form> (e.g. CreateInviteForm), that outer form's onSubmit would
    // otherwise fire too and submit it prematurely with whatever it currently holds.
    e.stopPropagation();
    setLoading(true);
    setError(null);

    const body = {
      name,
      powiat: powiat || null,
      voivodeship: voivodeship || null,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
    };

    try {
      const res = await fetch(mode === 'create' ? '/api/admin/gminas' : `/api/admin/gminas/${gmina!.id}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'Coś poszło nie tak.');
        return;
      }

      onSuccess?.(data.gmina);
      router.refresh();
      onClose();
    } catch (err) {
      console.error('[GminaFormModal] request failed:', err);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }

  // Rendered via a portal into document.body: this modal's own <form> would
  // otherwise nest inside whatever <form> the caller (e.g. CreateInviteForm)
  // renders it from, which is invalid HTML — browsers collapse nested forms
  // into one, so submitting this form actually submitted the outer one.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gmina-form-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
      {...backdropHandlers}
    >
      <div className="w-full max-w-lg max-h-[90vh] rounded-3xl bg-white shadow-xl overflow-hidden flex flex-col">
        <div className="modal-scrollbar min-h-0 overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 id="gmina-form-modal-title" className="text-lg font-bold text-slate-900">
            {mode === 'create' ? 'Nowa gmina' : 'Edytuj gminę'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            aria-label="Zamknij"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="gmina-name" className={labelClasses}>
              Nazwa
            </label>
            <input
              id="gmina-name"
              required
              autoFocus
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClasses}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="gmina-powiat" className={labelClasses}>
                Powiat
              </label>
              <input
                id="gmina-powiat"
                value={powiat}
                onChange={(e) => setPowiat(e.target.value)}
                className={inputClasses}
              />
            </div>
            <div>
              <label htmlFor="gmina-voivodeship" className={labelClasses}>
                Województwo
              </label>
              <input
                id="gmina-voivodeship"
                value={voivodeship}
                onChange={(e) => setVoivodeship(e.target.value)}
                className={inputClasses}
              />
            </div>
          </div>

          <div>
            <label className={labelClasses}>
              <MapPin className="inline h-3.5 w-3.5 -mt-0.5 mr-1 text-indigo-400" />
              Wskaż gminę na mapie (opcjonalnie)
            </label>
            <LocationPicker
              center={coords ? [coords.lat, coords.lng] : NOWA_DEBA_CENTER}
              value={coords}
              onPick={handlePick}
              color="#6366f1"
              icon="location"
            />
            {geo.status !== 'idle' && (
              <div
                className={`mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 transition-colors ${
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
                <span className="min-w-0 text-xs font-semibold break-words text-slate-700">
                  {geo.status === 'searching'
                    ? 'Rozpoznawanie lokalizacji…'
                    : geo.status === 'found'
                      ? geo.label
                      : 'Nie rozpoznano adresu — uzupełnij pola ręcznie.'}
                </span>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-rose-500">{error}</p>}

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" variant="primary" className="flex-1" disabled={loading}>
              {loading ? 'Zapisywanie…' : mode === 'create' ? 'Utwórz gminę' : 'Zapisz zmiany'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
              Anuluj
            </Button>
          </div>
        </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
