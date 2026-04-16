// =============================================================
// Category Icon
// =============================================================
// Maps market category → Lucide icon with themed color.
// =============================================================

import {
  Vote,
  TrendingUp,
  Bitcoin,
  Trophy,
  Film,
  Beaker,
  Cpu,
  Globe,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

const CATEGORY_CONFIG: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
  politics: { icon: Vote, color: 'text-red-400', bg: 'bg-red-500/10' },
  economics: { icon: TrendingUp, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  crypto: { icon: Bitcoin, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  sports: { icon: Trophy, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  entertainment: { icon: Film, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  science: { icon: Beaker, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  technology: { icon: Cpu, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
  world: { icon: Globe, color: 'text-teal-400', bg: 'bg-teal-500/10' },
  other: { icon: Sparkles, color: 'text-gray-400', bg: 'bg-gray-500/10' },
};

interface CategoryIconProps {
  category: string | null | undefined;
  size?: number;
  showBg?: boolean;
  className?: string;
}

export function CategoryIcon({ category, size = 14, showBg = false, className = '' }: CategoryIconProps) {
  const key = (category || 'other').toLowerCase();
  const cfg = CATEGORY_CONFIG[key] || CATEGORY_CONFIG.other;
  const Icon = cfg.icon;

  if (showBg) {
    return (
      <div
        className={`inline-flex items-center justify-center rounded-md ${cfg.bg} ${className}`}
        style={{ width: size + 10, height: size + 10 }}
      >
        <Icon size={size} className={cfg.color} />
      </div>
    );
  }

  return <Icon size={size} className={`${cfg.color} ${className}`} />;
}

export function getCategoryColor(category: string | null | undefined): string {
  const key = (category || 'other').toLowerCase();
  return (CATEGORY_CONFIG[key] || CATEGORY_CONFIG.other).color;
}
