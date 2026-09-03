import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { Navbar } from '@/components/layout/Navbar';
import { SessionProvider } from '@/components/providers/SessionProvider';

export const metadata: Metadata = {
  title: 'QFundation',
  description: 'Aplikacja QFundation',
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
      <body className="bg-slate-950 text-slate-100 antialiased min-h-screen flex flex-col">
        <SessionProvider>
          <Navbar />
          <div className="flex-1">
            {children}
          </div>
        </SessionProvider>
      </body>
    </html>
  );
}
