'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function DeleteOrganizationButton({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/organizations/${organizationId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'Coś poszło nie tak.');
        return;
      }

      router.refresh();
    } catch (err) {
      console.error('[DeleteOrganizationButton] request failed:', err);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] text-slate-500">
          Na pewno usunąć organizację <span className="font-semibold">{organizationName}</span>?
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="danger" size="sm" className="flex-1" disabled={loading} onClick={handleDelete}>
            {loading ? 'Usuwanie…' : 'Tak, usuń'}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => setConfirming(false)}>
            Anuluj
          </Button>
        </div>
        {error && <p className="text-xs text-rose-500">{error}</p>}
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50"
      onClick={() => setConfirming(true)}
    >
      <Trash2 className="h-3.5 w-3.5" />
      Usuń organizację
    </Button>
  );
}
