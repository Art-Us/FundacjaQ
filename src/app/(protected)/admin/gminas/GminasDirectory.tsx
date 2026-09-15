'use client';

import { useMemo, useState } from 'react';
import { Search, Plus, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GminaFormModal } from '@/components/gmina/GminaFormModal';
import { GminaCard } from './GminaCard';
import type { GminaListItem } from './types';

interface GminasDirectoryProps {
  gminas: GminaListItem[];
}

export function GminasDirectory({ gminas }: GminasDirectoryProps) {
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return gminas;
    return gminas.filter((gmina) => {
      const haystack = [gmina.name, gmina.powiat, gmina.voivodeship].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [gminas, query]);

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj po nazwie, powiecie, województwie…"
            className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 pl-10 pr-3 text-sm text-slate-800 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
          />
        </div>

        <span className="text-xs font-semibold text-slate-400 whitespace-nowrap">
          {filtered.length} z {gminas.length}
        </span>

        <Button type="button" size="sm" className="gap-1.5 shrink-0" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          Dodaj gminę
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl bg-white p-12 text-center border border-slate-200/80 shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 mb-3">
            <MapPin className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-700">Brak wyników</h3>
          <p className="text-xs text-slate-400 mt-1">Zmień kryteria wyszukiwania.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((gmina) => (
            <GminaCard key={gmina.id} gmina={gmina} />
          ))}
        </div>
      )}

      {showCreate && <GminaFormModal mode="create" onClose={() => setShowCreate(false)} />}
    </div>
  );
}
