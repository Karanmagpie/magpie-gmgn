// =============================================================
// App Layout — wraps all in-app pages with Sidebar
// =============================================================
// Used by: /dashboard, /markets, /wallets, /arbitrage
// NOT used by: / (landing)
// =============================================================

import { Sidebar } from '@/components/sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Sidebar />
      <main className="md:ml-56 min-h-screen pt-14 md:pt-0">
        {children}
      </main>
    </>
  );
}
