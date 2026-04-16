'use client';

// =============================================================
// Follow Button
// =============================================================
// Shown on wallet profiles + leaderboard rows.
// Requires wallet to be connected (via RainbowKit).
// Calls POST/DELETE /api/follows to follow/unfollow.
// =============================================================

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { api } from '@/lib/api';

interface FollowButtonProps {
  walletAddress: string;
  pseudonym?: string;
  size?: 'sm' | 'md';
}

export function FollowButton({ walletAddress, pseudonym, size = 'md' }: FollowButtonProps) {
  const { address: userAddress, isConnected } = useAccount();
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(false);

  // Check if already following on mount / when user connects
  useEffect(() => {
    if (!isConnected || !userAddress) return;

    api.follows.list(userAddress).then((data) => {
      const found = data.follows.some(
        (f: any) => f.wallet_address.toLowerCase() === walletAddress.toLowerCase()
      );
      setIsFollowing(found);
    }).catch(() => {});
  }, [isConnected, userAddress, walletAddress]);

  const handleClick = async () => {
    if (!isConnected || !userAddress || loading) return;
    setLoading(true);

    try {
      if (isFollowing) {
        await api.follows.unfollow(walletAddress, userAddress);
        setIsFollowing(false);
      } else {
        await api.follows.follow(userAddress, walletAddress, pseudonym);
        setIsFollowing(true);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  // Don't show if wallet not connected or trying to follow yourself
  if (!isConnected || !userAddress) return null;
  if (userAddress.toLowerCase() === walletAddress.toLowerCase()) return null;

  const sizeClasses = size === 'sm'
    ? 'px-2 py-0.5 text-[11px]'
    : 'px-3 py-1.5 text-xs';

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`${sizeClasses} rounded-lg font-medium transition-all disabled:opacity-50 ${
        isFollowing
          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-red-500/15 hover:text-red-400 hover:border-red-500/30'
          : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-emerald-500/30 hover:text-emerald-400'
      }`}
    >
      {loading ? '...' : isFollowing ? 'Following' : 'Follow'}
    </button>
  );
}
