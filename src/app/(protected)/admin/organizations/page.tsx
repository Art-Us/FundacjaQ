import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { RefreshOnMount } from '@/components/RefreshOnMount';
import { OrganizationsDirectory } from './OrganizationsDirectory';
import type { OrganizationListItem } from './types';

export default async function AdminOrganizationsPage() {
  const session = await getSession();
  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/');
  }

  const [organizations, gminas] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { name: 'asc' },
      // Same cap as the users directory page — this is a listing view, not
      // a dropdown data source, so it doesn't need every row.
      take: 200,
      include: {
        gmina: { select: { id: true, name: true } },
        _count: { select: { users: true } },
      },
    }),
    prisma.gmina.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  const items: OrganizationListItem[] = organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    street: organization.street,
    houseNumber: organization.houseNumber,
    apartmentNumber: organization.apartmentNumber,
    city: organization.city,
    postalCode: organization.postalCode,
    gminaId: organization.gminaId,
    gminaName: organization.gmina.name,
    contactFirstName: organization.contactFirstName,
    contactLastName: organization.contactLastName,
    contactPhone: organization.contactPhone,
    contactEmail: organization.contactEmail,
    usersCount: organization._count.users,
  }));

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-6">
      <RefreshOnMount />
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Organizacje</h1>
        <p className="text-sm text-slate-500 mt-1">Przeglądaj, twórz i zarządzaj organizacjami w systemie.</p>
      </div>

      <OrganizationsDirectory organizations={items} gminas={gminas} />
    </main>
  );
}
