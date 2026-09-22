'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, NotebookPen } from 'lucide-react';
import { ALERT_MESSAGE_TYPES, ALERT_MESSAGE_TYPE_LABELS } from '@/lib/alertMessageLabels';
import { apiSend } from '@/lib/apiClient';

interface NewJournalEntryModalProps {
  alertId: string;
  onClose: () => void;
  onCreated?: () => void;
}

// "+ Stwórz nowy wpis" (fot. 2/3, Крок 57) — creates a new root journal
// entry via POST /api/alerts/[id]/messages (Крок 53). Only ever rendered
// when the caller passes canPostAlertJournalEntry (ADMIN/COORDINATOR,
// AlertOperationalJournal.tsx) — the server enforces the same rule
// independently, so this is a UI convenience, not the real gate.
export default function NewJournalEntryModal({ alertId, onClose, onCreated }: NewJournalEntryModalProps) {
  const router = useRouter();
  const [type, setType] = useState<(typeof ALERT_MESSAGE_TYPES)[number]>(ALERT_MESSAGE_TYPES[0]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);

    const result = await apiSend(`/api/alerts/${alertId}/messages`, 'POST', {
      type,
      title: title.trim(),
      body: body.trim(),
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    router.refresh();
    onCreated?.();
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 p-6 sm:p-8 shadow-xl space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <NotebookPen className="h-4 w-4 text-indigo-600" />
            Stwórz nowy wpis
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Typ wpisu
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as (typeof ALERT_MESSAGE_TYPES)[number])}
              className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-2.5 text-slate-900 text-sm focus:bg-white focus:border-indigo-500 focus:outline-none"
            >
              {ALERT_MESSAGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ALERT_MESSAGE_TYPE_LABELS[t].label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Tytuł
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              placeholder="np. Sytuacja opanowana w strefie przy ul. Bieszczadzkiej"
              className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-2.5 text-slate-900 text-sm focus:bg-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Treść wpisu
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
              required
              rows={4}
              placeholder="Opisz sytuację, działania lub decyzję…"
              className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-2.5 text-slate-900 text-sm focus:bg-white focus:border-indigo-500 focus:outline-none resize-none"
            />
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={saving || !canSubmit}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm shadow-indigo-600/25 transition disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Zapisywanie...</span>
                </>
              ) : (
                <>
                  <NotebookPen className="h-3.5 w-3.5" />
                  <span>Dodaj wpis</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
