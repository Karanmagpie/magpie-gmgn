'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPrice, formatPct } from '@/lib/format';

export function ArbitrageCard() {
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.intelligence
      .arbitrage({ limit: '5' })
      .then((data) => setOpportunities(data.opportunities))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200">Arbitrage</h2>
        <Link href="/arbitrage" className="text-xs text-emerald-400 hover:text-emerald-300">
          View all
        </Link>
      </div>

      {loading ? (
        <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
      ) : opportunities.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-gray-500 text-sm">No arbitrage opportunities found</p>
          <p className="text-gray-600 text-xs mt-1">
            Cross-platform price gaps will appear here
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-800/50">
          {opportunities.map((opp) => (
            <div key={opp.id} className="px-4 py-3">
              <p className="text-sm text-gray-200 truncate mb-2">
                {opp.market_a_title || 'Market A'}
              </p>
              <div className="flex items-center gap-2 text-xs">
                <div className="flex-1 bg-gray-800 rounded px-2 py-1.5">
                  <span className="text-gray-500">{opp.market_a_platform}</span>
                  <span className="text-gray-200 ml-1">
                    {formatPrice(opp.market_a_yes_price)}
                  </span>
                </div>
                <span className="text-gray-600">vs</span>
                <div className="flex-1 bg-gray-800 rounded px-2 py-1.5">
                  <span className="text-gray-500">{opp.market_b_platform}</span>
                  <span className="text-gray-200 ml-1">
                    {formatPrice(opp.market_b_yes_price)}
                  </span>
                </div>
              </div>
              <div className="mt-1.5 text-xs text-emerald-400 font-medium">
                Spread: {formatPct(opp.spread_pct)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
