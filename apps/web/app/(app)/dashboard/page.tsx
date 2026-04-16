import { WhaleFeed } from '@/components/dashboard/whale-feed';
import { TrendingMarkets } from '@/components/dashboard/trending-markets';
import { ArbitrageCard } from '@/components/dashboard/arbitrage-card';
import { LeaderboardPreview } from '@/components/dashboard/leaderboard-preview';
import { HeroStats } from '@/components/dashboard/hero-stats';
import { TickerTape } from '@/components/ticker-tape';

export default function Home() {
  return (
    <div className="relative min-h-screen">
      {/* Ambient hero background — fades into dark */}
      <div
        className="absolute top-0 left-0 right-0 h-[400px] pointer-events-none"
        style={{
          backgroundImage: "url('/generated/hero-bg.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)',
          opacity: 0.4,
        }}
      />

      <div className="relative p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Live ticker — always visible at top */}
        <TickerTape />

        {/* Page header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Dashboard
          </h1>
          <p className="text-sm text-gray-500">Live whale activity + smart money signals</p>
        </div>

        {/* Hero Stats */}
        <HeroStats />

        {/* Live Whale Feed — full width */}
        <WhaleFeed />

        {/* Two column: Trending Markets + Arbitrage */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <TrendingMarkets />
          </div>
          <div>
            <ArbitrageCard />
          </div>
        </div>

        {/* Leaderboard */}
        <LeaderboardPreview />
      </div>
    </div>
  );
}
