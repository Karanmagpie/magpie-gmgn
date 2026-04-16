'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { api } from '@/lib/api';
import { formatUSD, formatPrice, timeAgo, truncateAddress, sideColor } from '@/lib/format';
import { WalletAvatar } from '@/components/wallet-avatar';
import { WhaleFeedSkeleton } from '@/components/skeleton';

type Tab = 'all' | 'following';

export function WhaleFeed() {
  const { address: userAddress, isConnected } = useAccount();
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [followCount, setFollowCount] = useState(0);

  // Fetch follow count when wallet connects
  useEffect(() => {
    if (!isConnected || !userAddress) {
      setFollowCount(0);
      return;
    }
    api.follows.list(userAddress).then((data) => {
      setFollowCount(data.count);
    }).catch(() => {});
  }, [isConnected, userAddress]);

  const fetchTrades = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'following' && isConnected && userAddress) {
        const data = await api.follows.feed(userAddress, { limit: '15' });
        setTrades(data.trades);
      } else {
        const data = await api.trades.list({ whale_only: 'true', limit: '10' });
        setTrades(data.trades);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [activeTab, isConnected, userAddress]);

  useEffect(() => {
    fetchTrades();
    const interval = setInterval(fetchTrades, 30000);
    return () => clearInterval(interval);
  }, [fetchTrades]);

  // Reset to "all" tab if wallet disconnects
  useEffect(() => {
    if (!isConnected) setActiveTab('all');
  }, [isConnected]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg">
      {/* Header with tabs */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          <h2 className="text-sm font-semibold text-gray-200">Live Feed</h2>
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1 text-xs rounded-lg transition-colors ${
              activeTab === 'all'
                ? 'bg-gray-800 text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            All Whales
          </button>
          {isConnected && (
            <button
              onClick={() => setActiveTab('following')}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                activeTab === 'following'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Following ({followCount})
            </button>
          )}
        </div>
      </div>

      {/* Trades list */}
      {loading ? (
        <WhaleFeedSkeleton />
      ) : trades.length === 0 ? (
        <div className="p-6 text-center">
          {activeTab === 'following' ? (
            <div className="space-y-2">
              <p className="text-gray-500 text-sm">No trades from followed wallets yet</p>
              <p className="text-gray-600 text-xs">
                Follow wallets from the{' '}
                <Link href="/wallets" className="text-emerald-400 hover:text-emerald-300">
                  Leaderboard
                </Link>{' '}
                to see their trades here
              </p>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No whale trades found yet</p>
          )}
        </div>
      ) : (
        <div className="divide-y divide-gray-800/50">
          {trades.map((trade) => (
            <div key={trade.id} className="px-4 py-3 hover:bg-gray-800/30 transition-colors">
              <div className="flex items-center justify-between gap-4">
                {/* Left: trade info */}
                <div className="flex-1 min-w-0 flex items-center gap-3">
                  <WalletAvatar address={trade.wallet_address} size={32} />
                  <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <Link
                      href={`/wallets/${trade.wallet_address || ''}`}
                      className="font-medium text-gray-200 hover:text-white"
                    >
                      {trade.wallet_pseudonym && !trade.wallet_pseudonym.startsWith('0x')
                        ? trade.wallet_pseudonym
                        : truncateAddress(trade.wallet_address)}
                    </Link>
                    <span className={`font-medium ${sideColor(trade.side)}`}>
                      {trade.side} {trade.outcome}
                    </span>
                    <span className="text-white font-semibold">{formatUSD(trade.size)}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {trade.market_title ? (
                      <Link
                        href={`/markets/${trade.market_id}`}
                        className="hover:text-gray-300"
                      >
                        {trade.market_title}
                      </Link>
                    ) : (
                      'Unknown market'
                    )}
                    {' '}@ {formatPrice(trade.price)}
                  </div>
                  </div>
                </div>

                {/* Right: time */}
                <span className="text-xs text-gray-600 whitespace-nowrap">
                  {timeAgo(trade.platform_timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
