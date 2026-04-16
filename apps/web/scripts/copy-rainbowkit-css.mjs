#!/usr/bin/env node
// =============================================================
// Copy RainbowKit CSS to public folder
// =============================================================
// Workaround for Tailwind v4 + RainbowKit PostCSS conflict.
// Tailwind v4's PostCSS plugin tries to process node_modules CSS
// and fails on RainbowKit's pre-compiled styles.
//
// This script copies the CSS to public/ at build time so it can
// be loaded via a <link> tag in the root layout, bypassing
// webpack CSS processing entirely.
// =============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the rainbowkit CSS path (tries monorepo root first, then local)
const candidates = [
  path.join(__dirname, '..', '..', '..', 'node_modules', '@rainbow-me', 'rainbowkit', 'dist', 'index.css'),
  path.join(__dirname, '..', 'node_modules', '@rainbow-me', 'rainbowkit', 'dist', 'index.css'),
];

const source = candidates.find((p) => fs.existsSync(p));
if (!source) {
  console.error('[copy-rainbowkit-css] Could not find @rainbow-me/rainbowkit/dist/index.css');
  console.error('  Tried:', candidates.join('\n    '));
  process.exit(1);
}

const dest = path.join(__dirname, '..', 'public', 'rainbowkit.css');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(source, dest);
console.log(`[copy-rainbowkit-css] Copied: ${path.basename(source)} → public/rainbowkit.css`);
