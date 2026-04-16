'use client';

// =============================================================
// Hero Stats — Dashboard top banner
// =============================================================
// Big numbers at the top of the dashboard showing platform scale.
// Cached at the API level for 60s.
// =============================================================

import { useEffect, useState } from 'react';
import { Activity, TrendingUp, Users, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { formatUSD } from '@/lib/format';
import { Skeleton } from '@/components/skeleton';

export function HeroStats() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.intelligence
      .stats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const items = [
    {
      label: 'Active Markets',
      value: stats?.active_markets?.toLocaleString() ?? '—',
      icon: TrendingUp,
      color: 'text-emerald-400',
      bg: 'from-emerald-500/10',
    },
    {
      label: 'Tracked Wallets',
      value: stats?.tracked_wallets?.toLocaleString() ?? '—',
      icon: Users,
      color: 'text-blue-400',
      bg: 'from-blue-500/10',
    },
    {
      label: '24h Volume',
      value: stats ? formatUSD(stats.volume_24h) : '—',
      icon: Activity,
      color: 'text-amber-400',
      bg: 'from-amber-500/10',
    },
    {
      label: '24h Whale Trades',
      value: stats?.whale_trades_24h?.toLocaleString() ?? '—',
      icon: Zap,
      color: 'text-purple-400',
      bg: 'from-purple-500/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className={`relative bg-gray-900/60 border border-gray-800 rounded-xl p-4 overflow-hidden group hover:border-gray-700 transition-colors`}
          >
            {/* Gradient background glow */}
            <div className={`absolute inset-0 bg-gradient-to-br ${item.bg} to-transparent opacity-50 group-hover:opacity-75 transition-opacity`} />

            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500 uppercase tracking-wide">{item.label}</span>
                <Icon size={14} className={item.color} />
              </div>
              {loading ? (
                <Skeleton className="h-7 w-24" />
              ) : (
                <div className={`text-xl md:text-2xl font-bold ${item.color}`}>
                  {item.value}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
