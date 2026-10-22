import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // The app may frame its own previews; nothing else may frame the app.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Published sites need "/sites/<slug>/" (with slash) for relative URLs; src/proxy.ts handles slashes.
  skipTrailingSlashRedirect: true,
  // Development only: allow opening the dev server via this machine's LAN IP
  // (e.g. http://192.168.0.93:3000) or 127.0.0.1, not just "localhost".
  // Without this, Next.js blocks its dev scripts and pages never become interactive.
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "10.*.*.*", "172.*.*.*"],
  // Native / binary packages are loaded with Node's require at runtime.
  serverExternalPackages: ["better-sqlite3", "esbuild", "@prisma/adapter-better-sqlite3", "@prisma/adapter-pg", "pg"],
  // Files read from disk at runtime (standalone/traced deployments must include them).
  outputFileTracingIncludes: {
    "/**": ["./preview-runner/**/*", "./src/server/scene-codegen/runtime.js.txt"],
    "/vendor/monaco/[...path]": ["./node_modules/monaco-editor/min/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path((?!preview/|preview-runtime/|sites/).*)", headers: securityHeaders }];
  },
};

export default nextConfig;
