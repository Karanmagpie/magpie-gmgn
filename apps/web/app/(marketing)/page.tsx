'use client';

// =============================================================
// Landing Page — "/"
// =============================================================
// Marketing page shown to first-time visitors.
// Click "Launch App" → /dashboard
// =============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Activity,
  TrendingUp,
  Users,
  Zap,
  Shield,
  Search,
  Copy,
  ArrowRight,
  Sparkles,
  Radar,
  ArrowRightLeft,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatUSD } from '@/lib/format';

export default function LandingPage() {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    api.intelligence
      .stats()
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div>
      {/* ========== HERO ========== */}
      <section className="relative overflow-hidden">
        {/* Background image with mask */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: "url('/generated/landing-hero.png')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: 0.35,
            maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 40%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 40%, transparent 100%)',
          }}
        />

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-gray-950/50 via-gray-950/30 to-gray-950 pointer-events-none" />

        {/* Content */}
        <div className="relative max-w-5xl mx-auto px-4 md:px-8 pt-20 pb-24 md:pt-32 md:pb-40 text-center">
          {/* Live pill */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-xs text-emerald-400 font-medium">
              {stats ? `${stats.whale_trades_24h.toLocaleString()} whale trades in last 24h` : 'Live whale activity'}
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-black tracking-tight leading-tight mb-6">
            <span className="bg-gradient-to-r from-white via-emerald-200 to-amber-200 bg-clip-text text-transparent">
              Track Smart Money
            </span>
            <br />
            <span className="bg-gradient-to-r from-emerald-400 via-amber-400 to-emerald-400 bg-clip-text text-transparent">
              on Prediction Markets
            </span>
          </h1>

          <p className="text-base md:text-lg text-gray-400 max-w-2xl mx-auto mb-8">
            Whale tracking, smart money consensus, cross-platform arbitrage, and market safety scores
            for Polymarket + Kalshi — all in one GMGN-style terminal.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/dashboard"
              className="px-6 py-3 text-base font-semibold rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 text-gray-950 hover:from-emerald-400 hover:to-emerald-300 transition-all shadow-lg shadow-emerald-500/30 inline-flex items-center gap-2"
            >
              Launch App <ArrowRight size={16} />
            </Link>
            <Link
              href="/markets"
              className="px-6 py-3 text-base font-semibold rounded-xl bg-gray-900 border border-gray-800 text-gray-300 hover:border-gray-700 hover:text-white transition-all"
            >
              Explore Markets
            </Link>
          </div>
        </div>
      </section>

      {/* ========== LIVE STATS STRIP ========== */}
      <section className="relative border-y border-gray-900">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatItem
            icon={TrendingUp}
            label="Active Markets"
            value={stats?.active_markets?.toLocaleString() ?? '—'}
            color="text-emerald-400"
          />
          <StatItem
            icon={Users}
            label="Tracked Wallets"
            value={stats?.tracked_wallets?.toLocaleString() ?? '—'}
            color="text-blue-400"
          />
          <StatItem
            icon={Activity}
            label="24h Volume"
            value={stats ? formatUSD(stats.volume_24h) : '—'}
            color="text-amber-400"
          />
          <StatItem
            icon={Zap}
            label="24h Whale Trades"
            value={stats?.whale_trades_24h?.toLocaleString() ?? '—'}
            color="text-purple-400"
          />
        </div>
      </section>

      {/* ========== FEATURES ========== */}
      <section className="max-w-6xl mx-auto px-4 md:px-8 py-20 md:py-28">
        <div className="text-center mb-12 md:mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Built for serious traders
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            Everything you need to trade prediction markets like an insider — powered by on-chain data and smart money analytics.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          <FeatureCard
            href="/dashboard"
            icon={Search}
            accent="emerald"
            title="Whale Tracking"
            description="Monitor $10K+ trades in real-time across Polymarket. See what smart wallets are buying before the market reacts."
            image="/generated/feature-whale.png"
          />
          <FeatureCard
            href="/wallets"
            icon={Sparkles}
            accent="amber"
            title="Smart Score"
            description="Every wallet gets a -100 to +100 score based on win rate, ROI, consistency and volume. Follow the ones who actually win."
          />
          <FeatureCard
            href="/markets"
            icon={Shield}
            accent="red"
            title="Market Safety"
            description="0-100 safety score per market — liquidity risk, resolution disputes, manipulation flags. Avoid traps before entering."
            image="/generated/feature-safety.png"
          />
          <FeatureCard
            href="/dashboard"
            icon={Radar}
            accent="cyan"
            title="Smart Money Consensus"
            description="See what top-scoring wallets think about each market. Volume-weighted YES/NO breakdown updated every 2 minutes."
          />
          <FeatureCard
            href="/arbitrage"
            icon={ArrowRightLeft}
            accent="purple"
            title="Cross-Platform Arbitrage"
            description="Match identical markets between Polymarket and Kalshi. Detect price gaps that let you lock in risk-free profit."
            image="/generated/feature-arbitrage.png"
          />
          <FeatureCard
            href="/wallets"
            icon={Copy}
            accent="blue"
            title="Follow Top Wallets"
            description="Connect your wallet, follow the whales that matter to you, get a personalized feed of only their trades."
          />
        </div>
      </section>

      {/* ========== HOW IT WORKS ========== */}
      <section className="relative border-t border-gray-900">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-20 md:py-28">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              How it works
            </h2>
            <p className="text-gray-400">Three steps. Zero friction.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 relative">
            {/* Connecting line (desktop) */}
            <div className="hidden md:block absolute top-10 left-[16%] right-[16%] h-px bg-gradient-to-r from-emerald-500/0 via-emerald-500/40 to-emerald-500/0" />

            <Step
              n={1}
              title="Connect Wallet"
              description="MetaMask or Rabby — just sign in. No gas, no custody, no fees. Wallet = your identity."
            />
            <Step
              n={2}
              title="Discover Whales"
              description="Browse the Smart Money leaderboard. Filter by Smart Score, ROI, win rate. Follow wallets that consistently print."
            />
            <Step
              n={3}
              title="Trade with Edge"
              description="See what smart money is doing in real time. Spot arbitrage. Find high-probability markets. Copy the pros."
            />
          </div>
        </div>
      </section>

      {/* ========== FINAL CTA ========== */}
      <section className="relative overflow-hidden border-t border-gray-900">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-amber-500/5 pointer-events-none" />

        <div className="relative max-w-3xl mx-auto px-4 md:px-8 py-20 md:py-28 text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Ready to trade smarter?
          </h2>
          <p className="text-gray-400 max-w-xl mx-auto mb-8">
            Join traders using smart money signals to find alpha in prediction markets. It&apos;s free to use.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 text-gray-950 hover:from-emerald-400 hover:to-emerald-300 transition-all shadow-lg shadow-emerald-500/30"
          >
            Launch App <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer className="border-t border-gray-900">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Image src="/generated/logo.png" alt="PMGN" width={24} height={24} className="rounded-md" />
            <span className="text-sm text-gray-500">PMGN &copy; 2026 · Smart Money for Prediction Markets</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-gray-500">
            <Link href="/dashboard" className="hover:text-gray-300 transition-colors">Dashboard</Link>
            <Link href="/markets" className="hover:text-gray-300 transition-colors">Markets</Link>
            <Link href="/wallets" className="hover:text-gray-300 transition-colors">Leaderboard</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

// =============================================================
// Sub-components
// =============================================================

function StatItem({ icon: Icon, label, value, color }: any) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg bg-gray-900 border border-gray-800 flex items-center justify-center ${color}`}>
        <Icon size={16} />
      </div>
      <div>
        <div className="text-[11px] text-gray-500 uppercase tracking-wider">{label}</div>
        <div className={`text-lg font-bold ${color}`}>{value}</div>
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, accent, title, description, image, href }: any) {
  const accents: Record<string, { gradient: string; text: string; border: string; glow: string }> = {
    emerald: { gradient: 'from-emerald-500/20 to-emerald-500/0', text: 'text-emerald-400', border: 'border-emerald-500/20', glow: 'hover:shadow-emerald-500/20' },
    amber:   { gradient: 'from-amber-500/20 to-amber-500/0',   text: 'text-amber-400',   border: 'border-amber-500/20',   glow: 'hover:shadow-amber-500/20' },
    red:     { gradient: 'from-red-500/20 to-red-500/0',       text: 'text-red-400',     border: 'border-red-500/20',     glow: 'hover:shadow-red-500/20' },
    cyan:    { gradient: 'from-cyan-500/20 to-cyan-500/0',     text: 'text-cyan-400',    border: 'border-cyan-500/20',    glow: 'hover:shadow-cyan-500/20' },
    purple:  { gradient: 'from-purple-500/20 to-purple-500/0', text: 'text-purple-400',  border: 'border-purple-500/20',  glow: 'hover:shadow-purple-500/20' },
    blue:    { gradient: 'from-blue-500/20 to-blue-500/0',     text: 'text-blue-400',    border: 'border-blue-500/20',    glow: 'hover:shadow-blue-500/20' },
  };
  const a = accents[accent];

  return (
    <Link
      href={href}
      className={`relative overflow-hidden bg-gray-900/40 border ${a.border} rounded-2xl p-6 group hover:bg-gray-900/70 hover:-translate-y-0.5 transition-all block hover:shadow-xl ${a.glow}`}
    >
      {/* Gradient wash */}
      <div className={`absolute inset-0 bg-gradient-to-br ${a.gradient} opacity-50 group-hover:opacity-100 transition-opacity pointer-events-none`} />

      {/* Optional image */}
      {image && (
        <div
          className="absolute inset-0 opacity-10 group-hover:opacity-25 transition-opacity pointer-events-none"
          style={{ backgroundImage: `url('${image}')`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
      )}

      {/* Hover arrow */}
      <div className={`absolute top-5 right-5 opacity-0 group-hover:opacity-100 transition-all translate-x-0 group-hover:translate-x-1 ${a.text}`}>
        <ArrowRight size={16} />
      </div>

      <div className="relative">
        <div className={`w-10 h-10 rounded-lg bg-gray-900 border ${a.border} flex items-center justify-center mb-4 ${a.text}`}>
          <Icon size={18} />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
        <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
      </div>
    </Link>
  );
}

function Step({ n, title, description }: { n: number; title: string; description: string }) {
  return (
    <div className="relative text-center">
      <div className="relative z-10 w-20 h-20 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-emerald-500 to-amber-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
        <span className="text-3xl font-black text-gray-950">{n}</span>
      </div>
      <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
      <p className="text-sm text-gray-400 max-w-xs mx-auto">{description}</p>
    </div>
  );
}
