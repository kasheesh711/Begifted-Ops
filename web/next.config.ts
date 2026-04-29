import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,    // SVC-01 — Phase 3 enables Cache Components
};

export default nextConfig;
