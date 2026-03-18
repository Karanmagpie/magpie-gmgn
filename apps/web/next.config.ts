import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Transpile the shared package so Next.js can use it
  transpilePackages: ['@markypie/shared'],
};

export default nextConfig;
