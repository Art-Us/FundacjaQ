'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, MessageSquare, NotebookPen, Send } from 'lucide-react';
import { getAlertMessageTypeInfo } from '@/lib/alertMessageLabels';
import { formatDate } from '@/lib/utils';
import NewJournalEntryModal from './NewJournalEntryModal';

interface JournalAuthor {
  id: string;
  name: string | null;
  email: string;
}

export interface JournalEntryRow {
  id: string;
  type: string | null;
  title: string | null;
  body: string;
  createdAt: Date | string;
  author: JournalAuthor | null;
  _count: { replies: number };
}

interface JournalReplyRow {
  id: string;
  body: string;
  createdAt: Date | string;
  author: JournalAuthor | null;
}

interface AlertOperationalJournalProps {
  alertId: string;
  entries: JournalEntryRow[];
  // canReplyToAlertForum (lib/authz.ts), computed once server-side in
  // page.tsx — the alert's owner org, any donor org, or ADMIN/COORDINATOR
  // (Крок 52). Gates only the reply form below; creating a new root entry
  // ("wpis") is a separate, narrower action gated by canPost below.
  canReply: boolean;
  // canPostAlertJournalEntry (lib/authz.ts) — ADMIN/COORDINATOR only (Крок
  // 52). Gates the "+ Stwórz nowy wpis" button (Крок 57); the server
  // enforces the same rule independently on POST /api/alerts/[id]/messages.
  canPost: boolean;
}

// The interactive half of the "Dziennik operacyjny & Forum Komunikatu"
// prototype (Фаза 8, Крок 56): a list of root entries ("wpisy"), each with a
// collapsible chat thread underneath, lazily fetched from
// /api/alerts/[id]/messages/[messageId]/replies (Крок 54) only once its
// entry is expanded — cards below never had this data server-rendered, to
// keep the page's initial payload to just the entry list (Крок 55).
export default function AlertOperationalJournal({ alertId, entries, canReply, canPost }: AlertOperationalJournalProps) {
  const router = useRouter();
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [repliesByEntry, setRepliesByEntry] = useState<Record<string, JournalReplyRow[]>>({});
  const [loadingEntryId, setLoadingEntryId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [sendingEntryId, setSendingEntryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNewEntryModal, setShowNewEntryModal] = useState(false);

  async function toggleEntry(entryId: string) {
    if (openEntryId === entryId) {
      setOpenEntryId(null);
      return;
    }
    setOpenEntryId(entryId);
    setError(null);

    if (repliesByEntry[entryId]) return;

    setLoadingEntryId(entryId);
    try {
      const res = await fetch(`/api/alerts/${alertId}/messages/${entryId}/replies`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Nie udało się wczytać czatu.');
        return;
      }
      setRepliesByEntry((prev) => ({ ...prev, [entryId]: data.replies }));
    } catch {
      setError('Nie udało się wczytać czatu.');
    } finally {
      setLoadingEntryId(null);
    }
  }

  async function sendReply(entryId: string) {
    const body = (replyDrafts[entryId] ?? '').trim();
    if (!body) return;

    setSendingEntryId(entryId);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${alertId}/messages/${entryId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Nie udało się wysłać wiadomości.');
        return;
      }
      setRepliesByEntry((prev) => ({ ...prev, [entryId]: [...(prev[entryId] ?? []), data.reply] }));
      setReplyDrafts((prev) => ({ ...prev, [entryId]: '' }));
      // Picks up the entry's own updated reply count next time this list is
      // server-rendered (e.g. the "Forum" badge on the alert's card, Крок 58).
      router.refresh();
    } catch {
      setError('Nie udało się wysłać wiadomości.');
    } finally {
      setSendingEntryId(null);
    }
  }

  return (
    <div className="space-y-3">
      {canPost && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowNewEntryModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition"
          >
            <NotebookPen className="h-3.5 w-3.5" />
            Stwórz nowy wpis
          </button>
        </div>
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}

      {entries.length === 0 && (
        <p className="text-xs text-slate-400">Brak wpisów w dzienniku operacyjnym.</p>
      )}

      {entries.map((entry) => {
        const typeInfo = getAlertMessageTypeInfo(entry.type ?? 'OTHER');
        const isOpen = openEntryId === entry.id;
        const loadedReplies = repliesByEntry[entry.id];
        const replyCount = loadedReplies?.length ?? entry._count.replies;

        return (
          <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-xl text-[11px] font-extrabold border uppercase tracking-wider shrink-0 ${typeInfo.badgeClass}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${typeInfo.dotClass}`} />
                  {typeInfo.label}
                </span>
                <p className="text-sm font-semibold text-slate-800 truncate">{entry.title}</p>
              </div>
              <span className="text-[11px] text-slate-500 shrink-0">
                {entry.author?.name ?? 'Użytkownik'} · {formatDate(entry.createdAt)}
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">{entry.body}</p>

            <button
              type="button"
              onClick={() => toggleEntry(entry.id)}
              className="flex items-center gap-1 text-xs font-bold text-indigo-700 hover:text-indigo-900 transition"
            >
              {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <MessageSquare className="h-3.5 w-3.5" />
              {isOpen ? 'Zwiń czat dyskusyjny' : `Pokaż czat (${replyCount})`}
            </button>

            {isOpen && (
              <div className="pt-2 border-t border-slate-200 space-y-2">
                {loadingEntryId === entry.id ? (
                  <p className="text-xs text-slate-400">Wczytywanie…</p>
                ) : (loadedReplies?.length ?? 0) === 0 ? (
                  <p className="text-xs text-slate-400">Brak wiadomości. Bądź pierwszy i napisz komentarz.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {loadedReplies!.map((reply) => (
                      <li key={reply.id} className="text-xs">
                        <span className="font-semibold text-slate-700">{reply.author?.name ?? 'Użytkownik'}</span>{' '}
                        <span className="text-slate-400">{formatDate(reply.createdAt)}</span>
                        <p className="text-slate-600">{reply.body}</p>
                      </li>
                    ))}
                  </ul>
                )}

                {canReply && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={replyDrafts[entry.id] ?? ''}
                      onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') sendReply(entry.id);
                      }}
                      placeholder="Napisz wiadomość na czacie tego wpisu…"
                      disabled={sendingEntryId === entry.id}
                      className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => sendReply(entry.id)}
                      disabled={sendingEntryId === entry.id || !(replyDrafts[entry.id] ?? '').trim()}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition disabled:opacity-50 shrink-0"
                    >
                      {sendingEntryId === entry.id ? (
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      Wyślij
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {showNewEntryModal && (
        <NewJournalEntryModal alertId={alertId} onClose={() => setShowNewEntryModal(false)} />
      )}
    </div>
  );
}
