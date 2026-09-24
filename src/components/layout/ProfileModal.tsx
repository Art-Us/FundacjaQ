'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Captcha } from '@/components/ui/Captcha';
import { useCaptchaGate } from '@/hooks/useCaptchaGate';
import { useBackdropDismiss } from '@/components/ui/useBackdropDismiss';

const inputClasses =
  'w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3.5 text-sm text-slate-900 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition';
const labelClasses = 'block text-xs font-bold text-slate-600 mb-1.5';

interface SelfProfile {
  name: string | null;
  email: string;
  phone: string | null;
}

interface ProfileModalProps {
  onClose: () => void;
  /** Called after a successful save, before onClose — lets the caller (Sidebar) reflect the new name without waiting for a full session refresh. */
  onSaved?: (user: SelfProfile) => void;
}

export function ProfileModal({ onClose, onSaved }: ProfileModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const captcha = useCaptchaGate();

  const backdropHandlers = useBackdropDismiss(onClose);

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

  // Sidebar only knows the display name (see ProtectedShell/layout.tsx) — email
  // and phone aren't threaded through props, so this modal fetches its own
  // current values on open rather than requiring every caller up the tree to
  // pass them down.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/user/me');
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? 'Nie udało się wczytać danych profilu.');
          return;
        }
        setName(data.user?.name ?? '');
        setEmail(data.user?.email ?? '');
        setPhone(data.user?.phone ?? '');
      } catch (err) {
        console.error('[ProfileModal] failed to load profile:', err);
        if (!cancelled) setError('Nie udało się połączyć z serwerem.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    // Captured before the request: a submitted token is single-use at
    // Google regardless of outcome, so it must be reset even after a
    // non-captcha failure (e.g. email taken) — otherwise a resubmit would
    // resend an already-consumed token and fail captcha verification too.
    const hadCaptchaToken = captcha.token !== null;

    try {
      const res = await fetch('/api/user/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, phone: phone || null, captchaToken: captcha.token ?? undefined }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.captchaRequired) {
          captcha.require();
        } else if (hadCaptchaToken) {
          captcha.reset();
        }
        setError(data.error ?? 'Coś poszło nie tak.');
        return;
      }

      onSaved?.(data.user);
      onClose();
    } catch (err) {
      console.error('[ProfileModal] request failed:', err);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
      {...backdropHandlers}
    >
      <div className="w-full max-w-md max-h-[90vh] rounded-3xl bg-white shadow-xl overflow-hidden flex flex-col">
        <div className="modal-scrollbar min-h-0 overflow-y-auto p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 id="profile-modal-title" className="text-lg font-bold text-slate-900">
              Twój profil
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

          {loading ? (
            <p className="text-sm text-slate-400">Ładowanie…</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="profile-name" className={labelClasses}>
                  Imię i nazwisko
                </label>
                <input
                  id="profile-name"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClasses}
                />
              </div>

              <div>
                <label htmlFor="profile-email" className={labelClasses}>
                  Email
                </label>
                <input
                  id="profile-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClasses}
                />
              </div>

              <div>
                <label htmlFor="profile-phone" className={labelClasses}>
                  Telefon
                </label>
                <input
                  id="profile-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputClasses}
                />
              </div>

              {captcha.required && <Captcha ref={captcha.ref} onToken={captcha.setToken} />}

              {error && <p className="text-xs text-rose-500">{error}</p>}

              <div className="flex items-center gap-2 pt-2">
                <Button type="submit" variant="primary" className="flex-1" disabled={saving || captcha.disabled}>
                  {saving ? 'Zapisywanie…' : 'Zapisz zmiany'}
                </Button>
                <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
                  Anuluj
                </Button>
              </div>
            </form>
          )}

          {loading && error && <p className="text-xs text-rose-500">{error}</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
