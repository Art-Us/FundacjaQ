'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function DeleteGminaButton({ gminaId, gminaName }: { gminaId: string; gminaName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/admin/gminas/${gminaId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));

    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    router.refresh();
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] text-slate-500">
          Na pewno usunąć gminę <span className="font-semibold">{gminaName}</span>?
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
      Usuń gminę
    </Button>
  );
}
