'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatUSD, formatPct, scoreColor, truncateAddress } from '@/lib/format';
import { FollowButton } from '@/components/follow-button';
import { WalletAvatar } from '@/components/wallet-avatar';
import { TableRowSkeleton } from '@/components/skeleton';

const PERIODS = ['7d', '30d', '90d', 'all'];
const SORT_OPTIONS = [
  { value: 'smart_score', label: 'Smart Score' },
  { value: 'pnl', label: 'PnL' },
  { value: 'volume', label: 'Volume' },
  { value: 'roi', label: 'ROI' },
];

const PAGE_SIZE = 25;

// Score breakdown popup for a single wallet
function ScorePopup({ wallet, onClose }: { wallet: any; onClose: () => void }) {
  const components = [
    { label: 'Win Rate', score: wallet.win_rate_score, weight: 40, detail: wallet.win_rate ? formatPct(wallet.win_rate) : null, color: 'emerald' },
    { label: 'ROI', score: wallet.roi_score, weight: 30, detail: wallet.roi ? formatPct(wallet.roi) : null, color: 'blue' },
    { label: 'Consistency', score: wallet.consistency_score, weight: 20, detail: wallet.sharpe_ratio != null ? `Sharpe ${parseFloat(wallet.sharpe_ratio).toFixed(2)}` : null, color: 'purple' },
    { label: 'Volume', score: wallet.volume_score, weight: 10, detail: formatUSD(wallet.total_volume), color: 'amber' },
  ];

  const qualityLabel = wallet.data_quality === 'high' ? 'High' : wallet.data_quality === 'medium' ? 'Medium' : 'Low';
  const qualityColor = wallet.data_quality === 'high' ? 'text-emerald-400' : wallet.data_quality === 'medium' ? 'text-yellow-400' : 'text-gray-500';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-base font-semibold text-white">
              {wallet.pseudonym || truncateAddress(wallet.address)}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Score Breakdown</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`text-2xl font-bold ${scoreColor(wallet.smart_score)}`}>
              {wallet.smart_score ?? '—'}
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
            >
              x
            </button>
          </div>
        </div>

        {/* Component bars */}
        <div className="px-5 py-4 space-y-4">
          {components.map((c) => {
            const val = c.score ?? 0;
            const barColor = val >= 70 ? 'bg-emerald-500' : val >= 40 ? 'bg-yellow-500' : val >= 10 ? 'bg-orange-500' : 'bg-red-500';
            return (
              <div key={c.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-200">{c.label}</span>
                    <span className="text-[10px] text-gray-600">{c.weight}% weight</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.detail && <span className="text-xs text-gray-500">{c.detail}</span>}
                    <span className="text-sm font-semibold text-gray-200">{c.score ?? '—'}</span>
                  </div>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`${barColor} h-full rounded-full transition-all duration-500`}
                    style={{ width: `${val}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Confidence:</span>
            <span className={`text-xs font-medium ${qualityColor}`}>{qualityLabel}</span>
            <span className="text-xs text-gray-600">({wallet.total_markets} markets)</span>
          </div>
          <Link
            href={`/wallets/${wallet.address}`}
            className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            View Profile →
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [period, setPeriod] = useState('30d');
  const [sort, setSort] = useState('smart_score');
  const [popupWallet, setPopupWallet] = useState<any>(null);

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.wallets.list({
        period,
        sort,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      setWallets(data.wallets);
      setTotal(data.total);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [period, sort, offset]);

  useEffect(() => { fetchWallets(); }, [fetchWallets]);
  useEffect(() => { setOffset(0); }, [period, sort]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Smart Money Leaderboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          {total.toLocaleString()} enriched wallets ranked by Smart Score
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3.5 py-1.5 text-xs rounded-lg font-medium transition-all ${
                period === p
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-gray-800/60 text-gray-400 border border-gray-800 hover:border-gray-600 hover:text-gray-300'
              }`}
            >
              {p === 'all' ? 'All Time' : p}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="bg-gray-800/60 border border-gray-800 text-gray-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-gray-600"
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>Sort: {s.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {Array.from({ length: 8 }).map((_, i) => (
                  <TableRowSkeleton key={i} cols={8} />
                ))}
              </tbody>
            </table>
          </div>
        ) : wallets.length === 0 ? (
          <div className="p-12 text-center text-gray-500 text-sm">
            No wallet scores available yet. Server is enriching wallets — check back in a few minutes.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                  <th className="text-left px-3 md:px-4 py-3 font-medium w-8 md:w-12">#</th>
                  <th className="text-left px-3 md:px-4 py-3 font-medium">Trader</th>
                  <th className="text-center px-3 md:px-4 py-3 font-medium">Score</th>
                  <th className="text-right px-3 md:px-4 py-3 font-medium">PnL</th>
                  <th className="text-right px-3 md:px-4 py-3 font-medium hidden sm:table-cell">Win Rate</th>
                  <th className="text-right px-3 md:px-4 py-3 font-medium hidden md:table-cell">ROI</th>
                  <th className="text-right px-3 md:px-4 py-3 font-medium hidden lg:table-cell">Volume</th>
                  <th className="text-right px-3 md:px-4 py-3 font-medium hidden lg:table-cell">Markets</th>
                  <th className="text-center px-3 md:px-4 py-3 font-medium w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {wallets.map((w, i) => (
                  <tr key={w.id} className="hover:bg-gray-800/30 transition-colors group">
                    <td className="px-3 md:px-4 py-3 text-gray-600 text-xs">{offset + i + 1}</td>
                    <td className="px-3 md:px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <WalletAvatar address={w.address} size={28} />
                        <div className="min-w-0">
                          <Link
                            href={`/wallets/${w.address}`}
                            className="text-gray-200 hover:text-white font-medium transition-colors text-xs md:text-sm"
                          >
                            {w.pseudonym || truncateAddress(w.address)}
                            {w.is_verified && (
                              <span className="text-[11px] text-blue-400 ml-1">✓</span>
                            )}
                          </Link>
                          {w.x_username && (
                            <div className="text-[11px] text-gray-600 hidden md:block">@{w.x_username}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 md:px-4 py-3 text-center">
                      <button
                        onClick={() => setPopupWallet(w)}
                        className={`inline-flex items-center gap-1 px-2 md:px-2.5 py-1 rounded-lg font-bold text-xs md:text-sm transition-all hover:ring-1 hover:ring-gray-600 cursor-pointer ${scoreColor(w.smart_score)} bg-gray-800/50`}
                        title="Click for score breakdown"
                      >
                        {w.smart_score ?? '—'}
                      </button>
                    </td>
                    <td className={`px-3 md:px-4 py-3 text-right font-medium text-xs md:text-sm ${
                      parseFloat(w.total_pnl) >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {formatUSD(w.total_pnl)}
                    </td>
                    <td className="px-3 md:px-4 py-3 text-right text-gray-300 hidden sm:table-cell">
                      {w.win_rate ? formatPct(w.win_rate) : '—'}
                    </td>
                    <td className={`px-3 md:px-4 py-3 text-right hidden md:table-cell ${
                      parseFloat(w.roi) >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {w.roi ? formatPct(w.roi) : '—'}
                    </td>
                    <td className="px-3 md:px-4 py-3 text-right text-gray-400 hidden lg:table-cell">
                      {formatUSD(w.total_volume)}
                    </td>
                    <td className="px-3 md:px-4 py-3 text-right text-gray-500 hidden lg:table-cell">
                      {w.total_markets ?? '—'}
                    </td>
                    <td className="px-3 md:px-4 py-3 text-center">
                      <FollowButton
                        walletAddress={w.address}
                        pseudonym={w.pseudonym}
                        size="sm"
                      />
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
                className="px-4 py-1.5 text-xs bg-gray-800 rounded-lg text-gray-300 disabled:opacity-30 hover:bg-gray-700 transition-colors"
              >
                Prev
              </button>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={currentPage >= totalPages}
                className="px-4 py-1.5 text-xs bg-gray-800 rounded-lg text-gray-300 disabled:opacity-30 hover:bg-gray-700 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Score Breakdown Popup */}
      {popupWallet && (
        <ScorePopup wallet={popupWallet} onClose={() => setPopupWallet(null)} />
      )}
    </div>
  );
}
