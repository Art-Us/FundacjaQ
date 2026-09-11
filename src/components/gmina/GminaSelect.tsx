'use client';

import { useMemo, useState } from 'react';
import { GminaFormModal } from './GminaFormModal';

export interface GminaOption {
  id: string;
  name: string;
}

export interface GminaSelectValue {
  gminaId: string | null;
  newGminaName: string | null;
}

const NEW_GMINA_VALUE = '__new__';

const selectClasses =
  'w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3.5 text-sm text-slate-900 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition';

interface GminaSelectProps {
  id?: string;
  gminas: GminaOption[];
  value: GminaSelectValue;
  onChange: (value: GminaSelectValue) => void;
  required?: boolean;
  disabled?: boolean;
  /**
   * 'inline' (default) shows a free-text input for the new gmina's name,
   * submitted as newGminaName alongside the rest of the form.
   * 'modal' opens the same create form used on the gmina management page —
   * it creates the gmina immediately via POST /api/admin/gminas and selects
   * the resulting id, so this select never needs to carry newGminaName.
   */
  newGminaMode?: 'inline' | 'modal';
}

export function GminaSelect({
  id,
  gminas,
  value,
  onChange,
  required = false,
  disabled = false,
  newGminaMode = 'inline',
}: GminaSelectProps) {
  const [creatingNew, setCreatingNew] = useState(Boolean(value.newGminaName));
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createdGminas, setCreatedGminas] = useState<GminaOption[]>([]);

  const options = useMemo(() => {
    if (createdGminas.length === 0) return gminas;
    const merged = [...gminas];
    for (const g of createdGminas) {
      if (!merged.some((m) => m.id === g.id)) merged.push(g);
    }
    return merged;
  }, [gminas, createdGminas]);

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = e.target.value;
    if (selected === NEW_GMINA_VALUE) {
      if (newGminaMode === 'modal') {
        setShowCreateModal(true);
        return;
      }
      setCreatingNew(true);
      onChange({ gminaId: null, newGminaName: '' });
      return;
    }
    setCreatingNew(false);
    onChange({ gminaId: selected || null, newGminaName: null });
  }

  return (
    <div className="space-y-2">
      <select
        id={id}
        value={creatingNew ? NEW_GMINA_VALUE : value.gminaId ?? ''}
        onChange={handleSelectChange}
        disabled={disabled}
        required={required && !creatingNew}
        className={selectClasses}
      >
        {!required && !creatingNew && <option value="">— Brak —</option>}
        {creatingNew && <option value="" disabled hidden />}
        {options.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
        <option value={NEW_GMINA_VALUE}>+ Nowa gmina…</option>
      </select>

      {creatingNew && newGminaMode === 'inline' && (
        <input
          type="text"
          autoFocus
          value={value.newGminaName ?? ''}
          onChange={(e) => onChange({ gminaId: null, newGminaName: e.target.value })}
          placeholder="Nazwa nowej gminy"
          required={required}
          disabled={disabled}
          maxLength={120}
          className={selectClasses}
        />
      )}

      {showCreateModal && (
        <GminaFormModal
          mode="create"
          onClose={() => setShowCreateModal(false)}
          onSuccess={(gmina) => {
            setCreatedGminas((prev) => [...prev, { id: gmina.id, name: gmina.name }]);
            onChange({ gminaId: gmina.id, newGminaName: null });
            setShowCreateModal(false);
          }}
        />
      )}
    </div>
  );
}
