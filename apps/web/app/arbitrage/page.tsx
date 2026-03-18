'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPrice, formatPct, timeAgo } from '@/lib/format';

export default function ArbitragePage() {
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.intelligence
      .arbitrage({ limit: '50' })
      .then((data) => setOpportunities(data.opportunities))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Arbitrage Opportunities</h1>
        <p className="text-sm text-gray-500">
          Cross-platform price gaps between Polymarket and Kalshi
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg">
        {loading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Scanning for opportunities...</div>
        ) : opportunities.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-sm">No active arbitrage opportunities right now</p>
            <p className="text-gray-600 text-xs mt-1">
              When the same market on Polymarket and Kalshi has different prices, it shows here
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {opportunities.map((opp) => (
              <div key={opp.id} className="px-5 py-4 hover:bg-gray-800/20 transition-colors">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-200">
                      {opp.market_a_title || 'Market A'}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      Detected {timeAgo(opp.detected_at)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-lg font-bold text-emerald-400">
                      {formatPct(opp.spread_pct)} spread
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Link
                    href={`/markets/${opp.market_a_id}`}
                    className="flex-1 bg-gray-800 hover:bg-gray-750 rounded-lg p-3 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        opp.market_a_platform === 'polymarket'
                          ? 'bg-purple-500/15 text-purple-400'
                          : 'bg-blue-500/15 text-blue-400'
                      }`}>
                        {opp.market_a_platform}
                      </span>
                      <div className="text-right">
                        <p className="text-emerald-400 font-medium">
                          YES {formatPrice(opp.market_a_yes_price)}
                        </p>
                        <p className="text-red-400 text-xs">
                          NO {formatPrice(opp.market_a_no_price)}
                        </p>
                      </div>
                    </div>
                  </Link>

                  <div className="text-gray-600 text-xs font-medium">VS</div>

                  <Link
                    href={`/markets/${opp.market_b_id}`}
                    className="flex-1 bg-gray-800 hover:bg-gray-750 rounded-lg p-3 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        opp.market_b_platform === 'polymarket'
                          ? 'bg-purple-500/15 text-purple-400'
                          : 'bg-blue-500/15 text-blue-400'
                      }`}>
                        {opp.market_b_platform}
                      </span>
                      <div className="text-right">
                        <p className="text-emerald-400 font-medium">
                          YES {formatPrice(opp.market_b_yes_price)}
                        </p>
                        <p className="text-red-400 text-xs">
                          NO {formatPrice(opp.market_b_no_price)}
                        </p>
                      </div>
                    </div>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
