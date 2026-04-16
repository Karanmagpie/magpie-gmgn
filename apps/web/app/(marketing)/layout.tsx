// =============================================================
// Marketing Layout — landing page only (no sidebar)
// =============================================================

import Link from 'next/link';
import Image from 'next/image';
import { ConnectButton } from '@rainbow-me/rainbowkit';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      {/* Top nav */}
      <nav className="sticky top-0 z-50 border-b border-gray-900/60 backdrop-blur-xl bg-gray-950/70">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/generated/logo.png" alt="PMGN" width={32} height={32} className="rounded-lg" />
            <span className="text-lg font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              PMGN
            </span>
          </Link>

          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden sm:block">
              <ConnectButton
                chainStatus="none"
                showBalance={false}
                accountStatus={{ smallScreen: 'avatar', largeScreen: 'address' }}
              />
            </div>
            <Link
              href="/dashboard"
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-400 text-gray-950 hover:from-emerald-400 hover:to-emerald-300 transition-all shadow-lg shadow-emerald-500/20"
            >
              Launch App →
            </Link>
          </div>
        </div>
      </nav>

      {children}
    </div>
  );
}
