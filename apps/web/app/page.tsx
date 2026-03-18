import { WhaleFeed } from '@/components/dashboard/whale-feed';
import { TrendingMarkets } from '@/components/dashboard/trending-markets';
import { ArbitrageCard } from '@/components/dashboard/arbitrage-card';
import { LeaderboardPreview } from '@/components/dashboard/leaderboard-preview';

export default function Home() {
  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-gray-500">Live whale activity + smart money signals</p>
      </div>

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
  );
}
