'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const inputClasses =
  'w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3.5 text-sm text-slate-900 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition';
const labelClasses = 'block text-xs font-bold text-slate-600 mb-1.5';

export interface GminaFormValue {
  id: string;
  name: string;
  powiat: string | null;
  voivodeship: string | null;
}

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    };

    const res = await fetch(mode === 'create' ? '/api/admin/gminas' : `/api/admin/gminas/${gmina!.id}`, {
      method: mode === 'create' ? 'POST' : 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    onSuccess?.(data.gmina);
    router.refresh();
    onClose();
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
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-xl space-y-5">
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
    </div>,
    document.body
  );
}
