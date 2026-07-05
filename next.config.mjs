/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PGlite (the pglite:// DATABASE_URL branch used by the Playwright online
  // suite and daemon-free dev) resolves its WASM relative to the package —
  // bundling breaks that; load it from node_modules at runtime instead.
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    return [
      {
        // The service worker must never be served stale, or an old cache
        // strategy outlives a deploy (registration also sets updateViaCache
        // "none" — this covers the CDN/proxy layer).
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" }]
      }
    ];
  }
};

export default nextConfig;
