import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

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
      <head>
        {/* RainbowKit CSS — loaded as static asset to bypass Tailwind v4 PostCSS */}
        <link rel="stylesheet" href="/rainbowkit.css" />
      </head>
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
