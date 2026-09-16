'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { X, Pencil, Save } from 'lucide-react';
import {
  SEVERITY_LABELS,
  ALERT_CATEGORY_LABELS,
  SEVERITY_MARKER_COLORS,
  CATEGORY_MARKER_COLORS,
  categoriesForKind,
} from '@/lib/alertLabels';
import type { AlertKindValue } from '@/lib/alertLabels';
import type { MapAlert } from './AlertMap';

const LocationPicker = dynamic(() => import('./LocationPicker'), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-400"
      style={{ height: 200 }}
    >
      Ładowanie mapy…
    </div>
  ),
});

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

interface AlertEditModalProps {
  alert: MapAlert;
  onClose: () => void;
}

export default function AlertEditModal({ alert, onClose }: AlertEditModalProps) {
  const router = useRouter();
  // Rodzaj wpisu jest niezmienny (patrz PATCH /api/alerts/[id]) — modal tylko
  // dostosowuje pola do tego, czym wpis już jest.
  const kind = (alert.kind === 'EVENT' ? 'EVENT' : 'ALERT') as AlertKindValue;
  const isEvent = kind === 'EVENT';
  const categoryOptions = categoriesForKind(kind);
  const [title, setTitle] = useState(alert.title);
  const [description, setDescription] = useState(alert.description);
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>(alert.severity as (typeof SEVERITIES)[number]);
  const [category, setCategory] = useState<string>(alert.category);
  const [location, setLocation] = useState(alert.location ?? '');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    alert.latitude != null && alert.longitude != null ? { lat: alert.latitude, lng: alert.longitude } : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pinColor = isEvent
    ? CATEGORY_MARKER_COLORS[category] ?? CATEGORY_MARKER_COLORS.OTHER_EVENT
    : SEVERITY_MARKER_COLORS[severity] ?? SEVERITY_MARKER_COLORS.MEDIUM;
  const pickerCenter: [number, number] = coords
    ? [coords.lat, coords.lng]
    : [alert.latitude ?? 50.4166, alert.longitude ?? 21.75];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/alerts/${alert.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        ...(isEvent ? {} : { severity }),
        category,
        location: location || undefined,
        ...(coords ? { latitude: coords.lat, longitude: coords.lng } : {}),
      }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-3xl bg-white border border-slate-200 p-6 sm:p-8 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Pencil className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isEvent ? 'Edytuj Zdarzenie Codzienne' : 'Edytuj Komunikat Kryzysowy'}
              </h3>
              <p className="text-xs text-slate-500">
                {isEvent
                  ? 'Zaktualizuj opis, typ wydarzenia lub przesuń punkt na mapie'
                  : 'Zaktualizuj treść, kategorię lub przesuń punkt zdarzenia na mapie'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                {isEvent ? 'Typ wydarzenia' : 'Kategoria'}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
              >
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {ALERT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            <div className={isEvent ? 'hidden' : undefined}>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Krytyczność zdarzenia
              </label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}
                className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2 px-3 text-slate-900 text-xs font-bold focus:bg-white focus:border-red-500 focus:outline-none cursor-pointer"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Tytuł / Nazwa zdarzenia
            </label>
            <input
              type="text"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2 px-3 text-slate-900 text-xs font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Treść komunikatu
            </label>
            <textarea
              required
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl bg-slate-50 border border-slate-200 p-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Lokalizacja (opcjonalnie)</label>
            <input
              type="text"
              maxLength={200}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="np. ul. Sportowa 3"
              className="w-full rounded-xl bg-slate-50 border border-slate-200 py-1.5 px-2.5 text-xs text-slate-900"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1.5">
              <span>Zmień lokalizację punktu na mapie</span>
            </label>
            <LocationPicker
              center={pickerCenter}
              value={coords}
              onPick={(lat, lng) => setCoords({ lat, lng })}
              color={pinColor}
              icon={isEvent ? 'event' : 'alert'}
            />
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading || !description.trim()}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm shadow-indigo-600/25 transition disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Zapisywanie...</span>
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  <span>Zapisz zmiany</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
