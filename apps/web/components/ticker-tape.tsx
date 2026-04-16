'use client';

// =============================================================
// Ticker Tape — Horizontal scrolling whale trades
// =============================================================
// Always-visible live activity feed at the very top of dashboard.
// Duplicates content so the marquee loops seamlessly.
// Pauses on hover.
// =============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '@/lib/api';
import { formatUSD, truncateAddress } from '@/lib/format';

export function TickerTape() {
  const [trades, setTrades] = useState<any[]>([]);

  useEffect(() => {
    const fetch = () => {
      api.trades
        .list({ whale_only: 'true', limit: '20' })
        .then((data) => setTrades(data.trades))
        .catch(() => {});
    };
    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, []);

  if (trades.length === 0) return null;

  // Duplicate the array so the marquee loops seamlessly
  const items = [...trades, ...trades];

  return (
    <div className="bg-gray-900/80 border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center">
        {/* Left label */}
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-800/50 border-r border-gray-800 shrink-0">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Live</span>
        </div>

        {/* Scrolling content */}
        <div className="flex-1 overflow-hidden">
          <div className="flex animate-ticker whitespace-nowrap py-2" style={{ width: 'max-content' }}>
            {items.map((trade, i) => {
              const isBuy = trade.side === 'BUY';
              const name = trade.wallet_pseudonym && !trade.wallet_pseudonym.startsWith('0x')
                ? trade.wallet_pseudonym
                : truncateAddress(trade.wallet_address);
              return (
                <Link
                  key={`${trade.id}-${i}`}
                  href={`/wallets/${trade.wallet_address || ''}`}
                  className="inline-flex items-center gap-2 px-4 text-xs hover:bg-gray-800/30 transition-colors"
                >
                  {isBuy ? (
                    <TrendingUp size={12} className="text-emerald-400" />
                  ) : (
                    <TrendingDown size={12} className="text-red-400" />
                  )}
                  <span className="text-gray-300 font-medium">{name}</span>
                  <span className={isBuy ? 'text-emerald-400' : 'text-red-400'}>
                    {trade.side} {trade.outcome}
                  </span>
                  <span className="text-white font-semibold">{formatUSD(trade.size)}</span>
                  <span className="text-gray-600 truncate max-w-xs">
                    · {trade.market_title || 'market'}
                  </span>
                  <span className="text-gray-700">|</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
