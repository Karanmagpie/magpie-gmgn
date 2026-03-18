'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatUSD, formatPrice, safetyColor } from '@/lib/format';

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

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.markets.list({
        category: category === 'all' ? undefined : category,
        platform: platform === 'all' ? undefined : platform,
        sort,
        limit: String(PAGE_SIZE),
        offset: String(offset),
        status: 'active',
      });
      setMarkets(data.markets);
      setTotal(data.total);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [category, platform, sort, offset]);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [category, platform, sort]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Markets</h1>
        <p className="text-sm text-gray-500">
          {total.toLocaleString()} active markets across Polymarket + Kalshi
        </p>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Category pills */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1 text-xs rounded-full capitalize transition-colors ${
                category === cat
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
              }`}
            >
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

        {/* Sort select */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-3 py-1.5"
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>Sort: {s.label}</option>
          ))}
        </select>
      </div>

      {/* Markets table */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Loading markets...</div>
        ) : markets.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No markets match your filters</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-800">
                  <th className="text-left px-4 py-2.5 font-medium">Market</th>
                  <th className="text-left px-4 py-2.5 font-medium">Platform</th>
                  <th className="text-left px-4 py-2.5 font-medium">Category</th>
                  <th className="text-right px-4 py-2.5 font-medium">YES</th>
                  <th className="text-right px-4 py-2.5 font-medium">NO</th>
                  <th className="text-right px-4 py-2.5 font-medium">Volume</th>
                  <th className="text-right px-4 py-2.5 font-medium">Safety</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {markets.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 max-w-md">
                      <Link
                        href={`/markets/${m.id}`}
                        className="text-gray-200 hover:text-white font-medium line-clamp-2"
                      >
                        {m.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        m.platform === 'polymarket'
                          ? 'bg-purple-500/15 text-purple-400'
                          : 'bg-blue-500/15 text-blue-400'
                      }`}>
                        {m.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs capitalize">
                      {m.category || 'other'}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400">
                      {formatPrice(m.yes_price)}
                    </td>
                    <td className="px-4 py-3 text-right text-red-400">
                      {formatPrice(m.no_price)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {formatUSD(m.volume)}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${safetyColor(m.safety_score)}`}>
                      {m.safety_score ?? '—'}
                    </td>
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
