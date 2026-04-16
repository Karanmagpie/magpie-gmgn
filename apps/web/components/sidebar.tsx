'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { LayoutDashboard, BarChart3, Trophy, ArrowRightLeft, type LucideIcon } from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/markets', label: 'Markets', icon: BarChart3 },
  { href: '/wallets', label: 'Leaderboard', icon: Trophy },
  { href: '/arbitrage', label: 'Arbitrage', icon: ArrowRightLeft },
];

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-gray-900 border-b border-gray-800 flex items-center px-4 z-50">
        <button
          onClick={() => setOpen(!open)}
          className="text-gray-300 hover:text-white p-1.5 -ml-1"
          aria-label="Toggle menu"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {open ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
        <Link href="/dashboard" className="flex items-center gap-2 ml-3">
          <Image src="/generated/logo.png" alt="PMGN" width={28} height={28} className="rounded-lg" />
          <span className="text-lg font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent tracking-tight">PMGN</span>
        </Link>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed left-0 top-0 h-full w-56 bg-gray-900 border-r border-gray-800 flex flex-col z-50
        transition-transform duration-200
        ${open ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
      `}>
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 px-5 py-5 border-b border-gray-800">
          <div className="rounded-xl overflow-hidden animate-glow">
            <Image src="/generated/logo.png" alt="PMGN" width={40} height={40} className="rounded-xl" priority />
          </div>
          <div>
            <div className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent tracking-tight leading-none">PMGN</div>
            <div className="text-[10px] text-gray-500 mt-0.5 tracking-wider uppercase">Smart Money</div>
          </div>
        </Link>

        {/* Nav Items */}
        <nav className="flex-1 py-3">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'text-white bg-gray-800/70 border-r-2 border-emerald-400'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/40'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-emerald-400' : ''} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Wallet Connect */}
        <div className="px-3 py-4 border-t border-gray-800">
          <ConnectButton
            chainStatus="none"
            showBalance={false}
            accountStatus={{
              smallScreen: 'avatar',
              largeScreen: 'address',
            }}
          />
        </div>
      </aside>
    </>
  );
}
