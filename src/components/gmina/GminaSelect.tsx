'use client';

import { useState } from 'react';

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
}

export function GminaSelect({ id, gminas, value, onChange, required = false, disabled = false }: GminaSelectProps) {
  const [creatingNew, setCreatingNew] = useState(Boolean(value.newGminaName));

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = e.target.value;
    if (selected === NEW_GMINA_VALUE) {
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
        {gminas.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
        <option value={NEW_GMINA_VALUE}>+ Nowa gmina…</option>
      </select>

      {creatingNew && (
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
    </div>
  );
}
