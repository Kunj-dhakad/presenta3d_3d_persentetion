import type { NextConfig } from "next";

/**
 * Pages that may put this app in an iframe: the PHP app (CI_Core) that hosts
 * the 3D presentation pages. Add more with FRAME_ANCESTORS (space separated,
 * read at build time). In development a PHP app on localhost may frame it too.
 */
const frameAncestors = [
  "'self'",
  "https://present3d.com", "https://*.present3d.com",
  ...(process.env.FRAME_ANCESTORS || "").split(/\s+/).filter(Boolean),
  ...(process.env.NODE_ENV !== "production" ? ["http://localhost:*", "http://127.0.0.1:*"] : []),
];

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // No X-Frame-Options: it cannot name other sites; frame-ancestors below does.
  { key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors.join(" ")}; base-uri 'self'; object-src 'none'` },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  skipTrailingSlashRedirect: true,

  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "10.*.*.*", "172.*.*.*"],
  serverExternalPackages: ["esbuild"],
  outputFileTracingIncludes: {
    "/**": [
      "./preview-runner/**/*",
      "./preview-runtime-dist/current.json",
      "./src/server/scene-codegen/runtime.js.txt",
      "./src/server/deck/runtime.js.txt",
    ],
    "/preview-runtime/[hash]/[...path]": ["./preview-runtime-dist/**/*"],
    "/api/**/*": ["./preview-runtime-dist/**/*", "./node_modules/esbuild/**/*", "./node_modules/@esbuild/**/*"],
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
