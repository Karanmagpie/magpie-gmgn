import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Transpile the shared package so Next.js can use it
  transpilePackages: ['@markypie/shared'],
  // MetaMask SDK tries to import React Native modules — stub them out
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@react-native-async-storage/async-storage': false,
    };
    return config;
  },
};

export default nextConfig;
