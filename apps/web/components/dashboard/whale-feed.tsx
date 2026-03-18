'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatUSD, formatPrice, timeAgo, truncateAddress, sideColor } from '@/lib/format';

export function WhaleFeed() {
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.trades
      .list({ whale_only: 'true', limit: '10' })
      .then((data) => setTrades(data.trades))
      .catch(() => {})
      .finally(() => setLoading(false));

    // Refresh every 30s
    const interval = setInterval(() => {
      api.trades
        .list({ whale_only: 'true', limit: '10' })
        .then((data) => setTrades(data.trades))
        .catch(() => {});
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
        <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
        <h2 className="text-sm font-semibold text-gray-200">Live Whale Feed</h2>
      </div>

      {loading ? (
        <div className="p-4 text-center text-gray-500 text-sm">Loading whale trades...</div>
      ) : trades.length === 0 ? (
        <div className="p-4 text-center text-gray-500 text-sm">No whale trades found yet</div>
      ) : (
        <div className="divide-y divide-gray-800/50">
          {trades.map((trade) => (
            <div key={trade.id} className="px-4 py-3 hover:bg-gray-800/30 transition-colors">
              <div className="flex items-center justify-between gap-4">
                {/* Left: trade info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-base">🐋</span>
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
