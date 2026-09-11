'use client';

import { useState } from 'react';
import { Pencil, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GminaFormModal } from '@/components/gmina/GminaFormModal';
import { DeleteGminaButton } from './DeleteGminaButton';
import type { GminaListItem } from './types';

export function GminaCard({ gmina }: { gmina: GminaListItem }) {
  const [showEdit, setShowEdit] = useState(false);
  const hasDependents =
    gmina.usersCount > 0 || gmina.resourcesCount > 0 || gmina.alertsCount > 0 || gmina.inviteTokensCount > 0;

  return (
    <article className="rounded-3xl bg-white border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition flex flex-col justify-between gap-4">
      <div className="space-y-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900 truncate">{gmina.name}</h3>
          {(gmina.powiat || gmina.voivodeship) ? (
            <p className="text-xs text-slate-500 truncate mt-0.5">
              {[gmina.powiat, gmina.voivodeship].filter(Boolean).join(', ')}
            </p>
          ) : (
            <p className="text-xs text-slate-400 mt-0.5">Brak powiatu/województwa</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Users className="h-3.5 w-3.5 shrink-0" />
          <span>
            {gmina.usersCount} użytk. · {gmina.resourcesCount} zasob. · {gmina.alertsCount} alert. ·{' '}
            {gmina.inviteTokensCount} zaprosz.
          </span>
        </div>
      </div>

      <div className="pt-2 flex flex-col gap-2 border-t border-slate-100">
        <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={() => setShowEdit(true)}>
          <Pencil className="h-3.5 w-3.5" />
          Edytuj
        </Button>
        {hasDependents ? (
          <p className="text-[11px] text-slate-400 text-center">
            Nie można usunąć — istnieją powiązane rekordy.
          </p>
        ) : (
          <DeleteGminaButton gminaId={gmina.id} gminaName={gmina.name} />
        )}
      </div>

      {showEdit && <GminaFormModal mode="edit" gmina={gmina} onClose={() => setShowEdit(false)} />}
    </article>
  );
}
