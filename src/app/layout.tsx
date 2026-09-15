import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';
import { SessionProvider } from '@/components/providers/SessionProvider';

const inter = Inter({ subsets: ['latin', 'latin-ext'], weight: ['300', '400', '500', '600', '700', '800'] });

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
      <body className={`${inter.className} bg-[#f4f7fb] text-slate-800 antialiased min-h-screen flex flex-col`}>
        <SessionProvider>
          <div className="flex-1 flex flex-col">{children}</div>
        </SessionProvider>
      </body>
    </html>
  );
}
