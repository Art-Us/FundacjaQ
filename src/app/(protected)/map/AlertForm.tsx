'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SEVERITY_LABELS } from '@/lib/alertLabels';
import type { Role } from '@/types';
import type { GminaOption } from './AlertsMapView';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

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
  const [location, setLocation] = useState('');
  const [gminaId, setGminaId] = useState(currentUserGminaId ?? gminy[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // COORDINATOR może tworzyć alerty tylko dla swojej gminy — pole i tak jest
  // wymuszone po stronie API, ale ukrywamy wybór w UI, żeby nie sugerować
  // czegoś, czego serwer i tak nie pozwoli zrobić.
  const gminaLocked = currentUserRole !== 'ADMIN';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!initialCoords) {
      setMessage('Kliknij najpierw na mapie, aby ustawić lokalizację alertu.');
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
        location: location || undefined,
        latitude: initialCoords.lat,
        longitude: initialCoords.lng,
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
      className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 flex flex-col gap-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-400">Tytuł</label>
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800 text-slate-100 text-sm px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-400">Krytyczność</label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
            className="rounded-lg border border-slate-700 bg-slate-800 text-slate-100 text-sm px-3 py-2"
          >
            {SEVERITIES.map((sev) => (
              <option key={sev} value={sev}>
                {SEVERITY_LABELS[sev]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm text-slate-400">Opis</label>
        <textarea
          required
          maxLength={2000}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 text-slate-100 text-sm px-3 py-2"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-400">Lokalizacja (opcjonalnie)</label>
          <input
            maxLength={200}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="np. ul. Rzeczna"
            className="rounded-lg border border-slate-700 bg-slate-800 text-slate-100 text-sm px-3 py-2"
          />
        </div>
        {!gminaLocked && (
          <div className="flex flex-col gap-1">
            <label className="text-sm text-slate-400">Gmina</label>
            <select
              value={gminaId}
              onChange={(e) => setGminaId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 text-slate-100 text-sm px-3 py-2"
            >
              {gminy.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        {initialCoords
          ? `Wybrana lokalizacja: ${initialCoords.lat.toFixed(4)}, ${initialCoords.lng.toFixed(4)}`
          : 'Kliknij na mapie powyżej, aby wybrać dokładną lokalizację.'}
      </p>

      {message && <p className="text-sm text-rose-400">{message}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:pointer-events-none text-white text-sm font-medium px-4 py-2 transition-colors"
        >
          {loading ? 'Zapisywanie…' : 'Utwórz alert'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-slate-700 text-slate-300 hover:border-slate-600 text-sm px-4 py-2 transition-colors"
        >
          Anuluj
        </button>
      </div>
    </form>
  );
}
