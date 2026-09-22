import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';
// Hoisted here from AlertMap.tsx/LocationPicker.tsx (which both used to import
// these independently): each of those is loaded client-only (see
// src/lib/dynamicClientOnly.tsx), so the stylesheet used to mount/unmount
// along with whichever one of them happened to be on screen. React tracks a
// <style>/<link> tag it manages this way as a shared, reference-counted
// "hoistable" resource — tearing one copy
// down while another lazy chunk is still mid-compile (only happens on a dev
// server's first cold visit to a route) could leave the other's reference
// pointing at a node whose parent had already been removed, surfacing as
// `Cannot read properties of null (reading 'removeChild')` on the next
// unrelated unmount. A CSS package import in the root layout runs exactly
// once for the whole session, so there's nothing left to race.
import 'leaflet/dist/leaflet.css';
import '@/app/(protected)/map/leaflet-theme.css';
import { SessionProvider } from '@/components/providers/SessionProvider';

const inter = Inter({ subsets: ['latin', 'latin-ext'], weight: ['300', '400', '500', '600', '700', '800'] });

export const metadata: Metadata = {
  title: 'ResQ',
  description: 'Aplikacja FundationQ',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading a per-request header opts every page under this layout into
  // dynamic rendering, which nonce-based CSP (src/middleware.ts) requires —
  // a statically prerendered page can't receive a fresh nonce per request.
  headers();
  return (
    <html lang="pl">
      <body className={`${inter.className} bg-[#f4f7fb] text-slate-800 antialiased min-h-screen flex flex-col`}>
        <SessionProvider>
          <div className="flex-1 flex flex-col">{children}</div>
        </SessionProvider>
      </body>
    </html>
  );
}
