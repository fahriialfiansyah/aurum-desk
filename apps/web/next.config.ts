import type { NextConfig } from 'next';
import path from 'node:path';

const monorepoRoot = path.join(import.meta.dirname, '../../');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@aurum/shared'],
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
};

export default nextConfig;
