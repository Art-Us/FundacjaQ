import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '@/components/layout/Navbar';

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
        <Navbar />
        <div className="flex-1">
          {children}
        </div>
      </body>
    </html>
  );
}
