import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '@/components/layout/Navbar';
import { SessionProvider } from '@/components/providers/SessionProvider';

export const metadata: Metadata = {
  title: 'QFundation',
  description: 'Aplikacja QFundation',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
