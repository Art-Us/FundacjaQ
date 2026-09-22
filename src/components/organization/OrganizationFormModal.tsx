'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBackdropDismiss } from '@/components/ui/useBackdropDismiss';
import { GminaSelect, type GminaOption, type GminaSelectValue } from '@/components/gmina/GminaSelect';

const inputClasses =
  'w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3.5 text-sm text-slate-900 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition';
const labelClasses = 'block text-xs font-bold text-slate-600 mb-1.5';

export interface OrganizationFormValue {
  id: string;
  name: string;
  street: string | null;
  houseNumber: string | null;
  apartmentNumber: string | null;
  city: string | null;
  postalCode: string | null;
  gminaId: string;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

interface OrganizationFormModalProps {
  mode: 'create' | 'edit';
  organization?: OrganizationFormValue;
  /** create mode only: pre-fills (but doesn't lock) the gmina picker below. */
  defaultGminaId?: string;
  gminas: GminaOption[];
  /** Forwarded to the nested GminaSelect — see its own doc comment. */
  canCreateGmina: boolean;
  onClose: () => void;
  /** Called with the created/updated organization right before onClose, once the API call succeeds. */
  onSuccess?: (organization: { id: string; name: string; gminaId: string }) => void;
}

export function OrganizationFormModal({
  mode,
  organization,
  defaultGminaId,
  gminas,
  canCreateGmina,
  onClose,
  onSuccess,
}: OrganizationFormModalProps) {
  const router = useRouter();
  const [name, setName] = useState(organization?.name ?? '');
  const [gmina, setGmina] = useState<GminaSelectValue>({
    gminaId: organization?.gminaId ?? defaultGminaId ?? null,
    newGminaName: null,
  });
  const [street, setStreet] = useState(organization?.street ?? '');
  const [houseNumber, setHouseNumber] = useState(organization?.houseNumber ?? '');
  const [apartmentNumber, setApartmentNumber] = useState(organization?.apartmentNumber ?? '');
  const [city, setCity] = useState(organization?.city ?? '');
  const [postalCode, setPostalCode] = useState(organization?.postalCode ?? '');
  const [contactFirstName, setContactFirstName] = useState(organization?.contactFirstName ?? '');
  const [contactLastName, setContactLastName] = useState(organization?.contactLastName ?? '');
  const [contactPhone, setContactPhone] = useState(organization?.contactPhone ?? '');
  const [contactEmail, setContactEmail] = useState(organization?.contactEmail ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // See the matching comment in GminaFormModal — this modal is rendered via
    // a portal but can still be opened from inside another <form> (e.g.
    // UserFormModal, via OrganizationSelect), so its own submit must not
    // re-bubble into that outer form.
    e.stopPropagation();

    if (!gmina.gminaId) {
      setError('Gmina jest wymagana.');
      return;
    }

    setLoading(true);
    setError(null);

    const body = {
      name,
      gminaId: gmina.gminaId,
      street: street.trim() || null,
      houseNumber: houseNumber.trim() || null,
      apartmentNumber: apartmentNumber.trim() || null,
      city: city.trim() || null,
      postalCode: postalCode.trim() || null,
      contactFirstName: contactFirstName.trim() || null,
      contactLastName: contactLastName.trim() || null,
      contactPhone: contactPhone.trim() || null,
      contactEmail: contactEmail.trim() || null,
    };

    try {
      const res = await fetch(
        mode === 'create' ? '/api/admin/organizations' : `/api/admin/organizations/${organization!.id}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'Coś poszło nie tak.');
        return;
      }

      onSuccess?.(data.organization);
      router.refresh();
      onClose();
    } catch (err) {
      console.error('[OrganizationFormModal] request failed:', err);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }

  // Rendered via a portal into document.body — same reasoning as
  // GminaFormModal: this modal's own <form> would otherwise nest inside
  // whatever <form> the caller renders it from (UserFormModal, via
  // OrganizationSelect), which browsers collapse into one invalid nested form.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="organization-form-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
      {...backdropHandlers}
    >
      <div className="w-full max-w-lg max-h-[90vh] rounded-3xl bg-white shadow-xl overflow-hidden flex flex-col">
        <div className="modal-scrollbar min-h-0 overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 id="organization-form-modal-title" className="text-lg font-bold text-slate-900">
            {mode === 'create' ? 'Nowa organizacja' : 'Edytuj organizację'}
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
            <label htmlFor="organization-name" className={labelClasses}>
              Nazwa
            </label>
            <input
              id="organization-name"
              required
              autoFocus
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClasses}
            />
          </div>

          <div>
            <label htmlFor="organization-gmina" className={labelClasses}>
              Gmina
            </label>
            <GminaSelect
              id="organization-gmina"
              gminas={gminas}
              value={gmina}
              onChange={setGmina}
              required
              newGminaMode="modal"
              canCreateGmina={canCreateGmina}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="organization-street" className={labelClasses}>
                Ulica
              </label>
              <input
                id="organization-street"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                className={inputClasses}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="organization-house-number" className={labelClasses}>
                  Nr domu
                </label>
                <input
                  id="organization-house-number"
                  value={houseNumber}
                  onChange={(e) => setHouseNumber(e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label htmlFor="organization-apartment-number" className={labelClasses}>
                  Nr mieszkania
                </label>
                <input
                  id="organization-apartment-number"
                  value={apartmentNumber}
                  onChange={(e) => setApartmentNumber(e.target.value)}
                  className={inputClasses}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="organization-city" className={labelClasses}>
                Miasto
              </label>
              <input
                id="organization-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={inputClasses}
              />
            </div>
            <div>
              <label htmlFor="organization-postal-code" className={labelClasses}>
                Kod pocztowy
              </label>
              <input
                id="organization-postal-code"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="00-000"
                className={inputClasses}
              />
            </div>
          </div>

          <div className="pt-1 border-t border-slate-100">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 mt-3">Osoba kontaktowa</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="organization-contact-first-name" className={labelClasses}>
                  Imię
                </label>
                <input
                  id="organization-contact-first-name"
                  value={contactFirstName}
                  onChange={(e) => setContactFirstName(e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label htmlFor="organization-contact-last-name" className={labelClasses}>
                  Nazwisko
                </label>
                <input
                  id="organization-contact-last-name"
                  value={contactLastName}
                  onChange={(e) => setContactLastName(e.target.value)}
                  className={inputClasses}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label htmlFor="organization-contact-phone" className={labelClasses}>
                  Telefon
                </label>
                <input
                  id="organization-contact-phone"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label htmlFor="organization-contact-email" className={labelClasses}>
                  Email
                </label>
                <input
                  id="organization-contact-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className={inputClasses}
                />
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-rose-500">{error}</p>}

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" variant="primary" className="flex-1" disabled={loading}>
              {loading ? 'Zapisywanie…' : mode === 'create' ? 'Utwórz organizację' : 'Zapisz zmiany'}
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
