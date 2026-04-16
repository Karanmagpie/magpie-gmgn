// =============================================================
// Wallet Configuration
// =============================================================
// RainbowKit + wagmi setup for wallet connection.
// MVP: MetaMask + Rabby only (browser extensions, no WalletConnect).
// User connects wallet → address becomes their identity for follows.
// =============================================================

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { polygon } from 'wagmi/chains';

// Polymarket lives on Polygon — use it as the primary chain
// projectId is a placeholder — WalletConnect QR not used in MVP,
// only MetaMask/Rabby browser extensions which don't need it.
export const config = getDefaultConfig({
  appName: 'PMGN',
  projectId: 'pmgn-mvp-no-walletconnect',
  chains: [polygon],
  ssr: true,
});
