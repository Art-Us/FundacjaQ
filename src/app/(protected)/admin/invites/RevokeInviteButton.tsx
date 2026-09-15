'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/invites/${inviteId}/revoke`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'Coś poszło nie tak.');
        return;
      }

      router.refresh();
    } catch (err) {
      console.error('[RevokeInviteButton] request failed:', err);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="secondary" size="sm" disabled={loading} onClick={handleRevoke}>
        {loading ? 'Unieważnianie…' : 'Unieważnij'}
      </Button>
      {error && <p className="text-xs text-rose-500">{error}</p>}
    </div>
  );
}