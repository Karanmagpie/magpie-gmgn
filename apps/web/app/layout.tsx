import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';

export const metadata: Metadata = {
  title: 'PMGN — Smart Money for Prediction Markets',
  description: 'Track whale wallets, copy trade smart money, and find arbitrage across Polymarket and Kalshi.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <Sidebar />
        <main className="md:ml-56 min-h-screen pt-14 md:pt-0">
          {children}
        </main>
      </body>
    </html>
  );
}
