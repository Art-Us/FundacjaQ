'use client';

import { useMemo, useState } from 'react';
import type { GminaOption } from '@/components/gmina/GminaSelect';
import { OrganizationFormModal } from './OrganizationFormModal';

export interface OrganizationOption {
  id: string;
  name: string;
  gminaId: string;
}

const NEW_ORGANIZATION_VALUE = '__new__';

const selectClasses =
  'w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3.5 text-sm text-slate-900 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition';

interface OrganizationSelectProps {
  id?: string;
  organizations: OrganizationOption[];
  /** Needed only to seed the "+ Nowa organizacja" create modal's own gmina picker. */
  gminas: GminaOption[];
  /** Pre-fills (but doesn't lock) the create modal's gmina — typically the caller's own currently-selected gmina, so a brand-new org defaults into the same one. */
  defaultGminaId?: string | null;
  value: string | null;
  onChange: (organizationId: string | null) => void;
  required?: boolean;
  disabled?: boolean;
}

/**
 * Unlike GminaSelect, there is no "inline text" creation mode: an
 * organization always has more required structure (its own gmina, address,
 * contact person) than a free-text name can carry, so "+ Nowa organizacja"
 * always opens the shared OrganizationFormModal and creates immediately via
 * POST /api/admin/organizations — this select never carries anything like
 * newGminaName through to the parent form's own submit.
 */
export function OrganizationSelect({
  id,
  organizations,
  gminas,
  defaultGminaId,
  value,
  onChange,
  required = false,
  disabled = false,
}: OrganizationSelectProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createdOrganizations, setCreatedOrganizations] = useState<OrganizationOption[]>([]);

  const options = useMemo(() => {
    if (createdOrganizations.length === 0) return organizations;
    const merged = [...organizations];
    for (const o of createdOrganizations) {
      if (!merged.some((m) => m.id === o.id)) merged.push(o);
    }
    return merged;
  }, [organizations, createdOrganizations]);

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = e.target.value;
    if (selected === NEW_ORGANIZATION_VALUE) {
      setShowCreateModal(true);
      return;
    }
    onChange(selected || null);
  }

  return (
    <div className="space-y-2">
      <select
        id={id}
        value={value ?? ''}
        onChange={handleSelectChange}
        disabled={disabled}
        required={required}
        className={selectClasses}
      >
        {!required && <option value="">— Brak —</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        <option value={NEW_ORGANIZATION_VALUE}>+ Nowa organizacja…</option>
      </select>

      {showCreateModal && (
        <OrganizationFormModal
          mode="create"
          gminas={gminas}
          defaultGminaId={defaultGminaId ?? undefined}
          onClose={() => setShowCreateModal(false)}
          onSuccess={(organization) => {
            setCreatedOrganizations((prev) => [
              ...prev,
              { id: organization.id, name: organization.name, gminaId: organization.gminaId },
            ]);
            onChange(organization.id);
            setShowCreateModal(false);
          }}
        />
      )}
    </div>
  );
}
