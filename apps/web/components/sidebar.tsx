'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '⚡' },
  { href: '/markets', label: 'Markets', icon: '📊' },
  { href: '/wallets', label: 'Leaderboard', icon: '🏆' },
  { href: '/arbitrage', label: 'Arbitrage', icon: '🔄' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-full w-56 bg-gray-900 border-r border-gray-800 flex flex-col z-50">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 px-5 py-5 border-b border-gray-800">
        <span className="text-xl font-bold text-white tracking-tight">PMGN</span>
        <span className="text-xs text-gray-500 mt-1">.io</span>
      </Link>

      {/* Nav Items */}
      <nav className="flex-1 py-3">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);

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
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="px-5 py-4 border-t border-gray-800">
        <p className="text-xs text-gray-600">Read-only MVP</p>
      </div>
    </aside>
  );
}
