import type { ReactNode } from 'react';
import { AdminEventsBridge } from '@/components/AdminEventsBridge';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AdminEventsBridge />
      {children}
    </>
  );
}
