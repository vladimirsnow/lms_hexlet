import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  serverExternalPackages: ["isomorphic-dompurify"],
  experimental: { cpus: 1, staleTimes: { static: 300, dynamic: 0 } },
};

export default nextConfig;
