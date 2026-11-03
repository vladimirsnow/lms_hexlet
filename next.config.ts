import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  htmlLimitedBots: /.*/,
  serverExternalPackages: ["isomorphic-dompurify"],
  experimental: { cpus: 1 },
};

export default nextConfig;
