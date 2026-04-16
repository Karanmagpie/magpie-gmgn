'use client';

// =============================================================
// Wallet Avatar
// =============================================================
// Deterministic identicon generated from wallet address.
// Zero API calls, zero external requests — pure SVG math.
// Every wallet address produces a unique colorful pattern.
// =============================================================

import Jazzicon, { jsNumberForAddress } from 'react-jazzicon';

interface WalletAvatarProps {
  address: string | null | undefined;
  size?: number;
  className?: string;
}

export function WalletAvatar({ address, size = 32, className = '' }: WalletAvatarProps) {
  if (!address) {
    return (
      <div
        className={`rounded-full bg-gray-800 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`rounded-full overflow-hidden shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <Jazzicon diameter={size} seed={jsNumberForAddress(address)} />
    </div>
  );
}
