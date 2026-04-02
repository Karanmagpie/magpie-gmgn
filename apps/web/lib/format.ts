// =============================================================
// Formatting Utilities
// =============================================================

// $1,234 or $1.2M or $45K
export function formatUSD(amount: number | string | null): string {
  if (amount === null || amount === undefined) return '$0';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '$0';

  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 1) return `${sign}$${abs.toFixed(0)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

// 0.65 → "65%"
export function formatPct(value: number | string | null): string {
  if (value === null || value === undefined) return '0%';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0%';
  // If value is already 0-100 range, just append %
  if (Math.abs(num) > 1) return `${num.toFixed(1)}%`;
  // If value is 0-1 range, multiply by 100
  return `${(num * 100).toFixed(1)}%`;
}

// 0.65 → "$0.65", 0.0025 → "$0.0025" (keeps meaningful precision)
export function formatPrice(price: number | string | null): string {
  if (price === null || price === undefined) return '$0.00';
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(num)) return '$0.00';
  // For very small prices (< $0.01), show enough decimals to see the real value
  if (num > 0 && num < 0.01) return `$${num.toFixed(4)}`;
  return `$${num.toFixed(2)}`;
}

// "2 min ago", "3h ago", "5d ago"
export function timeAgo(date: string | Date | null): string {
  if (!date) return '';
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Truncate wallet address: 0x7f3a...9b2c
export function truncateAddress(addr: string | null): string {
  if (!addr) return '';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// Smart Score color — green for high, red for low
export function scoreColor(score: number | null): string {
  if (score === null || score === undefined) return 'text-gray-400';
  if (score >= 70) return 'text-emerald-400';
  if (score >= 40) return 'text-yellow-400';
  if (score >= 0) return 'text-orange-400';
  return 'text-red-400';
}

// Safety score color
export function safetyColor(score: number | null): string {
  if (score === null || score === undefined) return 'text-gray-400';
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-yellow-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}

// "Expires in 4h", "Expires in 2d", "Expires in 12m"
export function timeUntil(date: string | Date | null): string {
  if (!date) return '';
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = then - now;

  if (diff <= 0) return 'Expired';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) {
    const minutes = Math.floor(diff / (1000 * 60));
    return `${minutes}m`;
  }
  if (hours < 24) return `${hours}h`;
  if (hours < 168) return `${Math.floor(hours / 24)}d`;
  return `${Math.floor(hours / 168)}w`;
}

// Estimated return color — green for higher returns
export function returnColor(pct: number | null): string {
  if (pct === null || pct === undefined) return 'text-gray-400';
  if (pct >= 10) return 'text-emerald-400';
  if (pct >= 5) return 'text-green-400';
  if (pct >= 2) return 'text-yellow-400';
  return 'text-orange-400';
}

// BUY = green, SELL = red
export function sideColor(side: string): string {
  return side === 'BUY' ? 'text-emerald-400' : 'text-red-400';
}
