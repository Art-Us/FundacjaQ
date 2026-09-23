import { publishAdminEvent } from './adminEvents';

/**
 * Tells every open map/dashboard/alert-details tab (components/AlertsLiveRefresh.tsx,
 * via /api/events) that `alertId` or something hanging off it — a need, an
 * allocation, a journal entry — just changed, so they re-fetch instead of
 * showing the list from whenever the page was first loaded. Carries no alert
 * data itself, only the id: every listener re-reads through its own normal,
 * authorized server render. Best-effort, like publishAdminEvent — call it
 * only after the write has succeeded.
 */
export async function publishAlertChange(alertId: string): Promise<void> {
  await publishAdminEvent({ scope: 'alerts', alertId });
}
