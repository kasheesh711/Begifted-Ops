import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,    // SVC-01 — Phase 3 enables Cache Components
  // SVC-02 — p-limit 5.0.0 uses the Node `imports` field (`#async_hooks`)
  // which Turbopack does not resolve in route bundles. Marking the package
  // server-external delegates module resolution to Node at runtime where the
  // Node-vs-stub branch resolves correctly.
  serverExternalPackages: ["p-limit"],
};

export default nextConfig;
