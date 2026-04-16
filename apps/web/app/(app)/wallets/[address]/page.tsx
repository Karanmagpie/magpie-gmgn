'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatUSD, formatPrice, formatPct, scoreColor, timeAgo, sideColor, truncateAddress } from '@/lib/format';
import { FollowButton } from '@/components/follow-button';
import { WalletAvatar } from '@/components/wallet-avatar';

const PERIODS = ['7d', '30d', '90d', 'all'];

export default function WalletProfilePage() {
  const params = useParams();
  const address = params.address as string;

  const [wallet, setWallet] = useState<any>(null);
  const [scores, setScores] = useState<Record<string, any>>({});
  const [positions, setPositions] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePeriod, setActivePeriod] = useState('all');

  useEffect(() => {
    if (!address) return;

    Promise.all([
      api.wallets.get(address),
      api.wallets.positions(address),
      api.wallets.trades(address, { limit: '20' }),
    ])
      .then(([walletData, posData, tradesData]) => {
        setWallet(walletData.wallet);
        setScores(walletData.scores);
        setPositions(posData.positions);
        setTrades(tradesData.trades);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [address]);

  if (loading) {
    return <div className="p-6 text-gray-500">Loading wallet profile...</div>;
  }

  if (!wallet) {
    return <div className="p-6 text-gray-500">Wallet not found</div>;
  }

  const s = scores[activePeriod] || null;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-6xl">
      {/* Breadcrumb + Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
          <Link href="/wallets" className="hover:text-gray-300 transition-colors">Leaderboard</Link>
          <span className="text-gray-700">/</span>
          <span className="text-gray-400">{wallet.pseudonym || truncateAddress(wallet.address)}</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0 flex items-center gap-4">
            <WalletAvatar address={wallet.address} size={56} />
            <div className="min-w-0">
              <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
                {wallet.pseudonym || truncateAddress(wallet.address)}
                {wallet.is_verified && <span className="text-blue-400 text-sm">✓</span>}
              </h1>
              <div className="flex items-center gap-3 mt-1.5 overflow-hidden">
                <span className="font-mono text-xs text-gray-500 truncate">{wallet.address}</span>
                {wallet.x_username && (
                  <span className="text-xs text-gray-400 shrink-0">@{wallet.x_username}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-start">
            <FollowButton
              walletAddress={wallet.address}
              pseudonym={wallet.pseudonym}
            />
            {wallet.leaderboard_rank && (
              <span className="px-3 py-1.5 bg-yellow-500/10 text-yellow-400 rounded-lg text-sm font-semibold border border-yellow-500/20">
                Rank #{wallet.leaderboard_rank}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex gap-1.5">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setActivePeriod(p)}
            className={`px-3.5 py-1.5 text-xs rounded-lg font-medium transition-all ${
              activePeriod === p
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-gray-800/60 text-gray-400 border border-gray-800 hover:border-gray-600 hover:text-gray-300'
            }`}
          >
            {p === 'all' ? 'All Time' : p}
          </button>
        ))}
      </div>

      {/* Main stats row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Smart Score"
          value={s?.smart_score ?? '—'}
          className={scoreColor(s?.smart_score)}
          large
        />
        <StatCard
          label="PnL"
          value={formatUSD(s?.total_pnl || wallet.total_pnl)}
          className={parseFloat(s?.total_pnl || wallet.total_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <StatCard
          label="Win Rate"
          value={s?.win_rate ? formatPct(s.win_rate) : '—'}
        />
        <StatCard
          label="ROI"
          value={s?.roi ? formatPct(s.roi) : '—'}
          className={parseFloat(s?.roi || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <StatCard
          label="Volume"
          value={formatUSD(s?.total_volume || wallet.total_volume)}
        />
        <StatCard
          label="Markets"
          value={s?.total_markets ?? '—'}
        />
      </div>

      {/* Score Breakdown + Category in 2 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Score Breakdown */}
        {s && s.win_rate_score != null && (
          <div className="bg-gray-900/50 border border-gray-800 rounded-xl">
            <div className="px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Score Breakdown</h2>
              {s.data_quality && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  s.data_quality === 'high' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' :
                  s.data_quality === 'medium' ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20' :
                  'bg-gray-800 text-gray-500 border border-gray-700'
                }`}>
                  {s.data_quality} confidence
                </span>
              )}
            </div>
            <div className="px-5 py-4 space-y-5">
              <ScoreBar label="Win Rate" score={s.win_rate_score} weight={40} detail={s.win_rate ? formatPct(s.win_rate) : null} />
              <ScoreBar label="ROI" score={s.roi_score} weight={30} detail={s.roi ? formatPct(s.roi) : null} />
              <ScoreBar label="Consistency" score={s.consistency_score} weight={20} detail={s.sharpe_ratio != null ? `Sharpe ${parseFloat(s.sharpe_ratio).toFixed(2)}` : null} />
              <ScoreBar label="Volume" score={s.volume_score} weight={10} detail={formatUSD(s.total_volume || wallet.total_volume)} />
            </div>
            <div className="px-5 py-3 border-t border-gray-800">
              <p className="text-[11px] text-gray-600 leading-relaxed">
                Final score is a weighted sum scaled to -100 to +100. Scores closer to 0 mean average performance.
                {s.data_quality === 'low' && ' Low confidence — fewer than 10 trades analyzed.'}
              </p>
            </div>
          </div>
        )}

        {/* Category expertise */}
        {s?.category_expertise && Object.keys(s.category_expertise).length > 0 && (
          <div className="bg-gray-900/50 border border-gray-800 rounded-xl">
            <div className="px-5 py-3.5 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-white">Category Expertise</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              {Object.entries(s.category_expertise)
                .sort(([, a]: any, [, b]: any) => {
                  const aVal = typeof a === 'number' ? a : (a?.pnl || 0);
                  const bVal = typeof b === 'number' ? b : (b?.pnl || 0);
                  return bVal - aVal;
                })
                .slice(0, 6)
                .map(([cat, data]: [string, any]) => {
                  const value = typeof data === 'number' ? data : (data?.pnl || 0);
                  const pct = Math.min(100, Math.abs(value) * 100);
                  return (
                    <div key={cat} className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-24 capitalize shrink-0">{cat}</span>
                      <div className="flex-1 bg-gray-800 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-emerald-500/80 h-full rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-300 w-12 text-right font-medium">
                        {(pct).toFixed(0)}%
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* Open Positions */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl">
        <div className="px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Open Positions</h2>
          <span className="text-xs text-gray-500">{positions.length} active</span>
        </div>
        {positions.length === 0 ? (
          <div className="p-6 text-gray-600 text-sm text-center">No open positions</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                  <th className="text-left px-5 py-2.5 font-medium">Market</th>
                  <th className="text-left px-4 py-2.5 font-medium">Side</th>
                  <th className="text-right px-4 py-2.5 font-medium">Size</th>
                  <th className="text-right px-4 py-2.5 font-medium">Entry</th>
                  <th className="text-right px-4 py-2.5 font-medium">Current</th>
                  <th className="text-right px-5 py-2.5 font-medium">PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {positions.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-2.5 max-w-xs">
                      <Link
                        href={`/markets/${p.market_id}`}
                        className="text-gray-200 hover:text-white truncate block transition-colors"
                      >
                        {p.market_title || 'Unknown market'}
                      </Link>
                    </td>
                    <td className={`px-4 py-2.5 font-medium ${
                      p.outcome === 'YES' ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {p.outcome}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-200">{formatUSD(p.current_value || p.size)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400">{formatPrice(p.avg_price)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400">{formatPrice(p.outcome === 'YES' ? p.yes_price : p.no_price)}</td>
                    <td className={`px-5 py-2.5 text-right font-medium ${
                      parseFloat(p.unrealized_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {formatUSD(p.unrealized_pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Trades */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl">
        <div className="px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Recent Trades</h2>
          <span className="text-xs text-gray-500">{trades.length} shown</span>
        </div>
        {trades.length === 0 ? (
          <div className="p-6 text-gray-600 text-sm text-center">No trades found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                  <th className="text-left px-5 py-2.5 font-medium">Market</th>
                  <th className="text-left px-4 py-2.5 font-medium">Action</th>
                  <th className="text-right px-4 py-2.5 font-medium">Size</th>
                  <th className="text-right px-4 py-2.5 font-medium">Price</th>
                  <th className="text-right px-5 py-2.5 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {trades.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-2.5 max-w-xs">
                      <Link
                        href={`/markets/${t.market_id}`}
                        className="text-gray-300 hover:text-white truncate block transition-colors"
                      >
                        {t.market_title || 'Unknown market'}
                      </Link>
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

function StatCard({ label, value, className = 'text-gray-200', large = false }: {
  label: string;
  value: string | number;
  className?: string;
  large?: boolean;
}) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl px-4 py-3">
      <p className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`${large ? 'text-2xl' : 'text-lg'} font-bold mt-1 ${className}`}>{value}</p>
    </div>
  );
}

function ScoreBar({ label, score, weight, detail }: {
  label: string;
  score: number | null;
  weight: number;
  detail: string | null;
}) {
  const val = score ?? 0;
  const barColor = val >= 70 ? 'bg-emerald-500' : val >= 40 ? 'bg-yellow-500' : val >= 10 ? 'bg-orange-500' : 'bg-red-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-200">{label}</span>
          <span className="text-[10px] text-gray-600">{weight}%</span>
        </div>
        <div className="flex items-center gap-2">
          {detail && <span className="text-xs text-gray-500">{detail}</span>}
          <span className="text-sm font-semibold text-gray-200 w-8 text-right">{score ?? '—'}</span>
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
}
