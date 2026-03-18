// =============================================================
// API Client
// =============================================================
//
// Fetch wrapper for the PMGN backend REST API.
// Server runs on PORT 3001, Next.js on PORT 3000.
//
// Every endpoint returns: { data: T | null, error: string | null }
// This client unwraps that and throws on errors.
//
// Usage:
//   import { api } from '@/lib/api';
//   const { markets, total } = await api.markets.list({ limit: 10 });
// =============================================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Generic fetch helper — handles JSON parsing + error shape
async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, API_BASE);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }

  const res = await fetch(url.toString(), {
    headers: { 'Content-Type': 'application/json' },
    // No caching for real-time data
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  const json = await res.json();

  // Our API returns { data: T, error: null } on success
  if (json.error) {
    throw new Error(json.error);
  }

  return json.data;
}

// =============================================================
// Typed API methods
// =============================================================

export const api = {
  // ---- Markets ----
  markets: {
    list: (params?: {
      platform?: string;
      category?: string;
      status?: string;
      min_safety_score?: string;
      sort?: string;
      limit?: string;
      offset?: string;
    }) =>
      apiFetch<{
        markets: any[];
        total: number;
        limit: number;
        offset: number;
      }>('/api/markets', params),

    get: (id: string) =>
      apiFetch<{
        market: any;
        consensus: any | null;
        matched_market: any | null;
      }>(`/api/markets/${id}`),

    trades: (id: string, params?: { limit?: string; offset?: string }) =>
      apiFetch<{
        trades: any[];
        total: number;
        limit: number;
        offset: number;
      }>(`/api/markets/${id}/trades`, params),
  },

  // ---- Wallets ----
  wallets: {
    list: (params?: {
      period?: string;
      sort?: string;
      limit?: string;
      offset?: string;
    }) =>
      apiFetch<{
        wallets: any[];
        total: number;
        limit: number;
        offset: number;
        period: string;
      }>('/api/wallets', params),

    get: (address: string) =>
      apiFetch<{
        wallet: any;
        scores: Record<string, any>;
      }>(`/api/wallets/${address}`),

    positions: (address: string) =>
      apiFetch<{
        positions: any[];
        total: number;
      }>(`/api/wallets/${address}/positions`),

    trades: (address: string, params?: {
      limit?: string;
      offset?: string;
      market_id?: string;
    }) =>
      apiFetch<{
        trades: any[];
        total: number;
        limit: number;
        offset: number;
      }>(`/api/wallets/${address}/trades`, params),
  },

  // ---- Trades ----
  trades: {
    list: (params?: {
      whale_only?: string;
      platform?: string;
      market_id?: string;
      limit?: string;
      offset?: string;
    }) =>
      apiFetch<{
        trades: any[];
        total: number;
        limit: number;
        offset: number;
      }>('/api/trades', params),
  },

  // ---- Intelligence ----
  intelligence: {
    consensus: (marketId: string) =>
      apiFetch<{
        market_id: string;
        market_title: string;
        current_yes_price: number | null;
        current_no_price: number | null;
        consensus: any | null;
      }>(`/api/intelligence/consensus/${marketId}`),

    arbitrage: (params?: { limit?: string; min_spread?: string }) =>
      apiFetch<{
        opportunities: any[];
        count: number;
      }>('/api/intelligence/arbitrage', params),

    smartMoney: (params?: {
      period?: string;
      min_score?: string;
      limit?: string;
    }) =>
      apiFetch<{
        wallets: any[];
        count: number;
        period: string;
        min_score: number;
      }>('/api/intelligence/smart-money', params),
  },
};
