'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatUSD, formatPrice, safetyColor } from '@/lib/format';

export function TrendingMarkets() {
  const [markets, setMarkets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.markets
      .list({ sort: 'volume', status: 'active', limit: '8', platform: 'polymarket' })
      .then((data) => setMarkets(data.markets))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200">Trending Markets</h2>
        <Link href="/markets" className="text-xs text-emerald-400 hover:text-emerald-300">
          View all
        </Link>
      </div>

      {loading ? (
        <div className="p-4 text-center text-gray-500 text-sm">Loading markets...</div>
      ) : markets.length === 0 ? (
        <div className="p-4 text-center text-gray-500 text-sm">No markets found</div>
      ) : (
        <div className="divide-y divide-gray-800/50">
          {markets.map((market) => (
            <Link
              key={market.id}
              href={`/markets/${market.id}`}
              className="block px-4 py-3 hover:bg-gray-800/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 font-medium truncate">
                    {market.title}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-400">
                      {market.category || 'other'}
                    </span>
                    <span>Vol: {formatUSD(market.volume)}</span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-sm font-medium text-emerald-400">
                    YES {formatPrice(market.yes_price)}
                  </div>
                  {market.safety_score !== null && (
                    <div className={`text-xs mt-0.5 ${safetyColor(market.safety_score)}`}>
                      Safety: {market.safety_score}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
