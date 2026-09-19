'use client';

import { useState } from 'react';
import { Pencil, MapPin, User, Phone, Mail, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OrganizationFormModal } from '@/components/organization/OrganizationFormModal';
import type { GminaOption } from '@/components/gmina/GminaSelect';
import { DeleteOrganizationButton } from './DeleteOrganizationButton';
import type { OrganizationListItem } from './types';

function formatAddress(organization: OrganizationListItem): string | null {
  const streetLine = [organization.street, organization.houseNumber].filter(Boolean).join(' ');
  const withApartment = organization.apartmentNumber ? `${streetLine}/${organization.apartmentNumber}` : streetLine;
  const cityLine = [organization.postalCode, organization.city].filter(Boolean).join(' ');
  const parts = [withApartment, cityLine].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

export function OrganizationCard({
  organization,
  gminas,
  onChanged,
}: {
  organization: OrganizationListItem;
  gminas: GminaOption[];
  onChanged: () => void;
}) {
  const [showEdit, setShowEdit] = useState(false);
  const hasDependents = organization.usersCount > 0;
  const address = formatAddress(organization);
  const contactName = [organization.contactFirstName, organization.contactLastName].filter(Boolean).join(' ');

  return (
    <article className="rounded-3xl bg-white border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition flex flex-col justify-between gap-4">
      <div className="space-y-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900 truncate">{organization.name}</h3>
          <p className="text-xs text-slate-500 truncate mt-0.5">{organization.gminaName}</p>
        </div>

        <div className="space-y-1 text-xs text-slate-500">
          {address && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{address}</span>
            </div>
          )}
          {contactName && (
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{contactName}</span>
            </div>
          )}
          {organization.contactPhone && (
            <div className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{organization.contactPhone}</span>
            </div>
          )}
          {organization.contactEmail && (
            <div className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{organization.contactEmail}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Users className="h-3.5 w-3.5 shrink-0" />
          <span>{organization.usersCount} użytk.</span>
        </div>
      </div>

      <div className="pt-2 flex flex-col gap-2 border-t border-slate-100">
        <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={() => setShowEdit(true)}>
          <Pencil className="h-3.5 w-3.5" />
          Edytuj
        </Button>
        {hasDependents ? (
          <p className="text-[11px] text-slate-400 text-center">Nie można usunąć — istnieją powiązani użytkownicy.</p>
        ) : (
          <DeleteOrganizationButton
            organizationId={organization.id}
            organizationName={organization.name}
            onDeleted={onChanged}
          />
        )}
      </div>

      {showEdit && (
        <OrganizationFormModal
          mode="edit"
          organization={organization}
          gminas={gminas}
          onClose={() => setShowEdit(false)}
          onSuccess={onChanged}
        />
      )}
    </article>
  );
}
