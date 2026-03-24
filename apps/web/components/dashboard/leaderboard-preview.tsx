'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatUSD, formatPct, scoreColor, truncateAddress } from '@/lib/format';

export function LeaderboardPreview() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.wallets
      .list({ period: '30d', sort: 'smart_score', limit: '10' })
      .then((data) => setWallets(data.wallets))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200">Top Smart Money (30d)</h2>
        <Link href="/wallets" className="text-xs text-emerald-400 hover:text-emerald-300">
          Full leaderboard
        </Link>
      </div>

      {loading ? (
        <div className="p-4 text-center text-gray-500 text-sm">Loading leaderboard...</div>
      ) : wallets.length === 0 ? (
        <div className="p-4 text-center text-gray-500 text-sm">
          No wallet scores calculated yet
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                <th className="text-left px-3 md:px-4 py-2 font-medium">Rank</th>
                <th className="text-left px-3 md:px-4 py-2 font-medium">Trader</th>
                <th className="text-right px-3 md:px-4 py-2 font-medium">Score</th>
                <th className="text-right px-3 md:px-4 py-2 font-medium">30d PnL</th>
                <th className="text-right px-3 md:px-4 py-2 font-medium hidden sm:table-cell">Win Rate</th>
                <th className="text-right px-3 md:px-4 py-2 font-medium hidden sm:table-cell">Volume</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {wallets.map((w, i) => (
                <tr key={w.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-3 md:px-4 py-2.5 text-gray-500">{i + 1}</td>
                  <td className="px-3 md:px-4 py-2.5">
                    <Link
                      href={`/wallets/${w.address}`}
                      className="text-gray-200 hover:text-white font-medium text-xs md:text-sm"
                    >
                      {w.pseudonym || truncateAddress(w.address)}
                    </Link>
                    {w.x_username && (
                      <span className="text-gray-600 text-xs ml-1 hidden md:inline">@{w.x_username}</span>
                    )}
                  </td>
                  <td className={`px-3 md:px-4 py-2.5 text-right font-semibold ${scoreColor(w.smart_score)}`}>
                    {w.smart_score ?? '—'}
                  </td>
                  <td className={`px-3 md:px-4 py-2.5 text-right text-xs md:text-sm ${
                    parseFloat(w.total_pnl) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {formatUSD(w.total_pnl)}
                  </td>
                  <td className="px-3 md:px-4 py-2.5 text-right text-gray-300 hidden sm:table-cell">
                    {w.win_rate ? formatPct(w.win_rate) : '—'}
                  </td>
                  <td className="px-3 md:px-4 py-2.5 text-right text-gray-400 hidden sm:table-cell">
                    {formatUSD(w.total_volume)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
