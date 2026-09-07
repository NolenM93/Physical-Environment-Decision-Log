import type { NextConfig } from 'next';

/**
 * GitHub Pages is static hosting. `STATIC_EXPORT=true` (set in the Pages
 * workflow) emits `out/` and prefixes assets with the repo name. Local
 * `next dev` keeps the optional /api/detect route.
 */
const exporting = process.env.STATIC_EXPORT === 'true';
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
const basePath = exporting && repo ? `/${repo}` : '';

const nextConfig: NextConfig = {
  output: exporting ? 'export' : undefined,
  images: { unoptimized: true },
  trailingSlash: exporting,
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
