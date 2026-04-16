'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatUSD, formatPrice, safetyColor, timeUntil, returnColor } from '@/lib/format';
import { CategoryIcon } from '@/components/category-icon';
import { TableRowSkeleton } from '@/components/skeleton';

const CATEGORIES = [
  'all', 'politics', 'sports', 'crypto', 'economics',
  'entertainment', 'science', 'technology', 'other',
];

const PLATFORMS = ['all', 'polymarket', 'kalshi'];
const SORT_OPTIONS = [
  { value: 'volume', label: 'Volume' },
  { value: 'safety_score', label: 'Safety Score' },
  { value: 'created_at', label: 'Newest' },
  { value: 'yes_price', label: 'YES Price' },
];

// Near Resolution / Bonding / Endgame config
// Based on real strategies: UnifAI endgame (>95%), bonding (>80%), endgame sweep (>95%)
const NEAR_RES_WINDOWS = [
  { value: '24h', label: '24 hours' },
  { value: '48h', label: '48 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

const PROBABILITY_TIERS = [
  { value: '0.80', label: '80%+ (Bond)', desc: 'Consensus formed' },
  { value: '0.90', label: '90%+ (Safe Bond)', desc: 'Strong consensus' },
  { value: '0.95', label: '95%+ (Endgame)', desc: 'Near certain' },
  { value: '0.99', label: '99%+ (Ultra Safe)', desc: 'Guaranteed' },
];

const PAGE_SIZE = 25;

export default function MarketsPage() {
  const [markets, setMarkets] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

  // Filters
  const [category, setCategory] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [sort, setSort] = useState('volume');

  // Near Resolution filter state
  const [nearResolution, setNearResolution] = useState(false);
  const [nearResWindow, setNearResWindow] = useState('7d');
  const [minProbability, setMinProbability] = useState('0.90');

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.markets.list({
        category: category === 'all' ? undefined : category,
        platform: platform === 'all' ? undefined : platform,
        sort: nearResolution ? 'end_date' : sort,
        limit: String(PAGE_SIZE),
        offset: String(offset),
        status: 'active',
        near_resolution: nearResolution ? nearResWindow : undefined,
        min_probability: nearResolution ? minProbability : undefined,
      });
      setMarkets(data.markets);
      setTotal(data.total);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [category, platform, sort, offset, nearResolution, nearResWindow, minProbability]);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [category, platform, sort, nearResolution, nearResWindow, minProbability]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Markets</h1>
        <p className="text-sm text-gray-500">
          {nearResolution
            ? `${total.toLocaleString()} near-resolution markets (${(parseFloat(minProbability) * 100).toFixed(0)}%+ probability, expiring within ${nearResWindow})`
            : `${total.toLocaleString()} active markets across Polymarket + Kalshi`
          }
        </p>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Category pills with icons */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1 text-xs rounded-full capitalize transition-colors inline-flex items-center gap-1.5 ${
                category === cat
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
              }`}
            >
              {cat !== 'all' && <CategoryIcon category={cat} size={12} />}
              {cat}
            </button>
          ))}
        </div>

        {/* Platform select */}
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-3 py-1.5"
        >
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{p === 'all' ? 'All Platforms' : p}</option>
          ))}
        </select>

        {/* Sort select (hidden when near resolution active — auto-sorts by expiry) */}
        {!nearResolution && (
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-3 py-1.5"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>Sort: {s.label}</option>
            ))}
          </select>
        )}

        {/* Near Resolution toggle */}
        <button
          onClick={() => setNearResolution(!nearResolution)}
          className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${
            nearResolution
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
              : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
          }`}
        >
          {nearResolution ? 'Near Resolution ON' : 'Near Resolution'}
        </button>
      </div>

      {/* Near Resolution filter panel — shown when toggled on */}
      {nearResolution && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
            <span>Near Resolution / Bonding Filter</span>
            <span className="text-xs text-gray-500 font-normal">
              High-probability markets expiring soon — based on endgame &amp; bonding strategies
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {/* Probability tier */}
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Min Probability</label>
              <div className="flex gap-1.5">
                {PROBABILITY_TIERS.map((tier) => (
                  <button
                    key={tier.value}
                    onClick={() => setMinProbability(tier.value)}
                    title={tier.desc}
                    className={`px-2.5 py-1 text-xs rounded transition-colors ${
                      minProbability === tier.value
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    {tier.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Time window */}
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Expires Within</label>
              <div className="flex gap-1.5">
                {NEAR_RES_WINDOWS.map((w) => (
                  <button
                    key={w.value}
                    onClick={() => setNearResWindow(w.value)}
                    className={`px-2.5 py-1 text-xs rounded transition-colors ${
                      nearResWindow === w.value
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Markets table */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {Array.from({ length: 8 }).map((_, i) => (
                  <TableRowSkeleton key={i} cols={7} />
                ))}
              </tbody>
            </table>
          </div>
        ) : markets.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No markets match your filters</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-800">
                  <th className="text-left px-3 md:px-4 py-2.5 font-medium">Market</th>
                  <th className="text-left px-3 md:px-4 py-2.5 font-medium hidden sm:table-cell">Platform</th>
                  {!nearResolution && (
                    <th className="text-left px-3 md:px-4 py-2.5 font-medium hidden lg:table-cell">Category</th>
                  )}
                  <th className="text-right px-3 md:px-4 py-2.5 font-medium">YES</th>
                  <th className="text-right px-3 md:px-4 py-2.5 font-medium hidden sm:table-cell">NO</th>
                  {nearResolution ? (
                    <>
                      <th className="text-right px-3 md:px-4 py-2.5 font-medium">Side</th>
                      <th className="text-right px-3 md:px-4 py-2.5 font-medium">Est. Return</th>
                      <th className="text-right px-3 md:px-4 py-2.5 font-medium">Expires</th>
                    </>
                  ) : (
                    <>
                      <th className="text-right px-3 md:px-4 py-2.5 font-medium">Volume</th>
                      <th className="text-right px-3 md:px-4 py-2.5 font-medium hidden md:table-cell">Safety</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {markets.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-3 md:px-4 py-3 max-w-[200px] md:max-w-md">
                      <Link
                        href={`/markets/${m.id}`}
                        className="text-gray-200 hover:text-white font-medium line-clamp-2 text-xs md:text-sm"
                      >
                        {m.title}
                      </Link>
                    </td>
                    <td className="px-3 md:px-4 py-3 hidden sm:table-cell">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        m.platform === 'polymarket'
                          ? 'bg-purple-500/15 text-purple-400'
                          : 'bg-blue-500/15 text-blue-400'
                      }`}>
                        {m.platform}
                      </span>
                    </td>
                    {!nearResolution && (
                      <td className="px-3 md:px-4 py-3 text-gray-400 text-xs capitalize hidden lg:table-cell">
                        <span className="inline-flex items-center gap-1.5">
                          <CategoryIcon category={m.category} size={12} />
                          {m.category || 'other'}
                        </span>
                      </td>
                    )}
                    <td className="px-3 md:px-4 py-3 text-right text-emerald-400 text-xs md:text-sm">
                      {formatPrice(m.yes_price)}
                    </td>
                    <td className="px-3 md:px-4 py-3 text-right text-red-400 hidden sm:table-cell">
                      {formatPrice(m.no_price)}
                    </td>
                    {nearResolution ? (
                      <>
                        <td className="px-3 md:px-4 py-3 text-right text-xs">
                          <span className={`px-2 py-0.5 rounded font-medium ${
                            m.dominant_outcome === 'YES'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-red-500/15 text-red-400'
                          }`}>
                            {m.dominant_outcome || '—'} {m.dominant_price ? `${(m.dominant_price * 100).toFixed(1)}%` : ''}
                          </span>
                        </td>
                        <td className={`px-3 md:px-4 py-3 text-right font-semibold text-xs md:text-sm ${returnColor(m.est_return_pct)}`}>
                          {m.est_return_pct != null ? `+${Number(m.est_return_pct).toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-3 md:px-4 py-3 text-right text-amber-400 text-xs">
                          {timeUntil(m.end_date)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 md:px-4 py-3 text-right text-gray-300 text-xs md:text-sm">
                          {formatUSD(m.volume)}
                        </td>
                        <td className={`px-3 md:px-4 py-3 text-right font-medium hidden md:table-cell ${safetyColor(m.safety_score)}`}>
                          {m.safety_score ?? '—'}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <span className="text-xs text-gray-500">
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0}
                className="px-3 py-1 text-xs bg-gray-800 rounded text-gray-300 disabled:opacity-30 hover:bg-gray-700"
              >
                Prev
              </button>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={currentPage >= totalPages}
                className="px-3 py-1 text-xs bg-gray-800 rounded text-gray-300 disabled:opacity-30 hover:bg-gray-700"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
