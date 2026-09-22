'use client';

import { useState } from 'react';
import { AuditLogDirectory } from './AuditLogDirectory';
import { SecurityEventDirectory } from './SecurityEventDirectory';

const TABS = [
  { key: 'audit', label: 'Zmiany administracyjne' },
  { key: 'login', label: 'Logowania' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

interface LogsTabsProps {
  /** Only a global admin (gminaId === null) sees login attempts — see GET /api/admin/login-attempts. */
  canSeeLoginAttempts: boolean;
}

export function LogsTabs({ canSeeLoginAttempts }: LogsTabsProps) {
  const [tab, setTab] = useState<TabKey>('audit');
  const visibleTabs = canSeeLoginAttempts ? TABS : TABS.filter((t) => t.key !== 'login');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold transition -mb-px border-b-2 ${
              tab === t.key
                ? 'text-indigo-600 border-indigo-600'
                : 'text-slate-500 border-transparent hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'audit' && <AuditLogDirectory />}

      {tab === 'login' && (
        <SecurityEventDirectory
          endpoint="/api/admin/login-attempts"
          emptyLabel="Zmień kryteria filtrowania albo wróć później."
        />
      )}
    </div>
  );
}
