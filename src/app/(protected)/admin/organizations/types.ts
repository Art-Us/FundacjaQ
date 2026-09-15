export interface OrganizationListItem {
  id: string;
  name: string;
  street: string | null;
  houseNumber: string | null;
  apartmentNumber: string | null;
  city: string | null;
  postalCode: string | null;
  gminaId: string;
  gminaName: string;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  usersCount: number;
}
