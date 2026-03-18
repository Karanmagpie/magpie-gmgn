'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatUSD, formatPrice, formatPct, safetyColor, timeAgo, sideColor, truncateAddress } from '@/lib/format';

export default function MarketDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [market, setMarket] = useState<any>(null);
  const [consensus, setConsensus] = useState<any>(null);
  const [matchedMarket, setMatchedMarket] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    Promise.all([
      api.markets.get(id),
      api.markets.trades(id, { limit: '20' }),
    ])
      .then(([marketData, tradesData]) => {
        setMarket(marketData.market);
        setConsensus(marketData.consensus);
        setMatchedMarket(marketData.matched_market);
        setTrades(tradesData.trades);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="p-6 text-gray-500">Loading market...</div>;
  }

  if (!market) {
    return <div className="p-6 text-gray-500">Market not found</div>;
  }

  const safety = market.safety_details;
  const score = market.safety_score;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
          <Link href="/markets" className="hover:text-gray-300 transition-colors">Markets</Link>
          <span className="text-gray-700">/</span>
          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
            market.platform === 'polymarket'
              ? 'bg-purple-500/15 text-purple-400'
              : 'bg-blue-500/15 text-blue-400'
          }`}>
            {market.platform}
          </span>
          <span className="capitalize">{market.category || 'other'}</span>
          {market.end_date && (
            <span>Ends: {new Date(market.end_date).toLocaleDateString()}</span>
          )}
        </div>
        <h1 className="text-xl font-bold text-white">{market.title}</h1>
      </div>

      {/* Price bar */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl px-5 py-4">
        <div className="flex items-center gap-8">
          <div>
            <span className="text-[11px] text-gray-500 uppercase tracking-wide">YES</span>
            <p className="text-2xl font-bold text-emerald-400">{formatPrice(market.yes_price)}</p>
          </div>
          <div>
            <span className="text-[11px] text-gray-500 uppercase tracking-wide">NO</span>
            <p className="text-2xl font-bold text-red-400">{formatPrice(market.no_price)}</p>
          </div>
          <div>
            <span className="text-[11px] text-gray-500 uppercase tracking-wide">Volume</span>
            <p className="text-lg font-semibold text-gray-200">{formatUSD(market.volume)}</p>
          </div>
          <div>
            <span className="text-[11px] text-gray-500 uppercase tracking-wide">Liquidity</span>
            <p className="text-lg font-semibold text-gray-200">{formatUSD(market.liquidity)}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Safety Score */}
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl flex-1 min-w-0">
          <div className="px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Market Safety</h2>
            <span className={`text-xl font-bold ${safetyColor(score)}`}>
              {score ?? '—'}<span className="text-sm text-gray-500 font-normal">/100</span>
            </span>
          </div>

          {safety ? (
            <div className="p-5 space-y-4">
              {/* Overall score bar */}
              <div>
                <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-yellow-500' : score >= 40 ? 'bg-orange-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${score}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                  <span>Risky</span>
                  <span>Safe</span>
                </div>
              </div>

              {/* Risk Flags */}
              {safety.risk_flags && safety.risk_flags.length > 0 && (
                <div>
                  <p className="text-xs text-red-400 font-medium mb-2">
                    Risk Factors ({safety.risk_flags.length})
                    <span className="text-gray-600 font-normal ml-1">-{safety.risk_points} pts</span>
                  </p>
                  <div className="space-y-1.5">
                    {safety.risk_flags.map((flag: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            flag.severity === 'critical' ? 'bg-red-500' :
                            flag.severity === 'high' ? 'bg-orange-500' :
                            flag.severity === 'medium' ? 'bg-yellow-500' : 'bg-gray-500'
                          }`} />
                          <span className="text-gray-300">{formatFlagName(flag.name)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            flag.severity === 'critical' ? 'bg-red-500/10 text-red-400' :
                            flag.severity === 'high' ? 'bg-orange-500/10 text-orange-400' :
                            flag.severity === 'medium' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-gray-800 text-gray-500'
                          }`}>
                            {flag.severity}
                          </span>
                          <span className="text-red-400 w-6 text-right">-{flag.points}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Trust Flags */}
              {safety.trust_flags && safety.trust_flags.length > 0 && (
                <div>
                  <p className="text-xs text-emerald-400 font-medium mb-2">
                    Trust Factors ({safety.trust_flags.length})
                    <span className="text-gray-600 font-normal ml-1">+{safety.trust_points} pts</span>
                  </p>
                  <div className="space-y-1.5">
                    {safety.trust_flags.map((flag: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            flag.level === 'high' ? 'bg-emerald-500' :
                            flag.level === 'medium' ? 'bg-emerald-400' : 'bg-emerald-300'
                          }`} />
                          <span className="text-gray-300">{formatFlagName(flag.name)}</span>
                        </div>
                        <span className="text-emerald-400">+{flag.points}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-5 text-gray-500 text-sm">Safety score not yet calculated</div>
          )}
        </div>

        {/* Smart Money Consensus */}
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl flex-1 min-w-0">
          <div className="px-5 py-3.5 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-white">Smart Money Consensus</h2>
          </div>
          {consensus ? (
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-emerald-400 font-medium">YES {formatPct(consensus.weighted_yes_pct || consensus.yes_pct)}</span>
                    <span className="text-red-400 font-medium">NO {formatPct(consensus.weighted_no_pct || consensus.no_pct)}</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full"
                      style={{ width: `${((consensus.weighted_yes_pct || consensus.yes_pct) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-500">
                Based on {consensus.smart_wallet_count} smart money wallets (score &ge; 60)
              </div>
              {consensus.total_smart_value && (
                <div className="text-xs text-gray-500">
                  Total smart money deployed: {formatUSD(consensus.total_smart_value)}
                </div>
              )}
            </div>
          ) : (
            <div className="p-5 text-gray-600 text-sm">
              No smart money consensus data yet
            </div>
          )}
        </div>
      </div>

      {/* Cross-Platform Match */}
      {matchedMarket && (
        <div className="bg-gray-900/50 border border-emerald-500/20 rounded-xl">
          <div className="px-5 py-3.5 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-emerald-400">Cross-Platform Match</h2>
          </div>
          <div className="p-5">
            <div className="flex items-center gap-4">
              <div className="flex-1 bg-gray-800/50 rounded-lg p-3">
                <span className="text-[11px] text-gray-500 uppercase">{market.platform}</span>
                <p className="text-emerald-400 font-medium mt-1">YES: {formatPrice(market.yes_price)}</p>
              </div>
              <span className="text-gray-600 text-sm">vs</span>
              <div className="flex-1 bg-gray-800/50 rounded-lg p-3">
                <span className="text-[11px] text-gray-500 uppercase">{matchedMarket.platform}</span>
                <p className="text-emerald-400 font-medium mt-1">YES: {formatPrice(matchedMarket.yes_price)}</p>
              </div>
            </div>
            <Link
              href={`/markets/${matchedMarket.id}`}
              className="text-xs text-emerald-400 hover:text-emerald-300 mt-3 inline-block transition-colors"
            >
              View matched market: {matchedMarket.title} →
            </Link>
          </div>
        </div>
      )}

      {/* Recent Trades */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl">
        <div className="px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Recent Trades</h2>
          <span className="text-xs text-gray-500">{trades.length} shown</span>
        </div>
        {trades.length === 0 ? (
          <div className="p-5 text-gray-600 text-sm text-center">No trades recorded for this market</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                  <th className="text-left px-5 py-2.5 font-medium">Trader</th>
                  <th className="text-left px-4 py-2.5 font-medium">Side</th>
                  <th className="text-right px-4 py-2.5 font-medium">Size</th>
                  <th className="text-right px-4 py-2.5 font-medium">Price</th>
                  <th className="text-right px-5 py-2.5 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {trades.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-2.5">
                      <span className="text-gray-300">
                        {t.wallet_pseudonym || truncateAddress(t.wallet_address)}
                      </span>
                      {t.is_whale && <span className="ml-1.5 text-xs text-yellow-400">whale</span>}
                    </td>
                    <td className={`px-4 py-2.5 font-medium ${sideColor(t.side)}`}>
                      {t.side} {t.outcome}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-200">{formatUSD(t.size)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400">{formatPrice(t.price)}</td>
                    <td className="px-5 py-2.5 text-right text-gray-600 text-xs">{timeAgo(t.platform_timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Convert snake_case flag names to readable text
function formatFlagName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
