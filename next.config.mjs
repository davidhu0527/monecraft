/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PGlite (the pglite:// DATABASE_URL branch used by the Playwright online
  // suite and daemon-free dev) resolves its WASM relative to the package —
  // bundling breaks that; load it from node_modules at runtime instead.
  serverExternalPackages: ["@electric-sql/pglite"]
};

export default nextConfig;
