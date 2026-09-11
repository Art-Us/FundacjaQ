export interface GminaListItem {
  id: string;
  name: string;
  powiat: string | null;
  voivodeship: string | null;
  latitude: number | null;
  longitude: number | null;
  usersCount: number;
  resourcesCount: number;
  alertsCount: number;
  inviteTokensCount: number;
}
