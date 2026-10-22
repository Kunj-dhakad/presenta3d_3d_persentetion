import { NextResponse, type NextRequest } from "next/server";

/**
 * Trailing-slash handling (with `skipTrailingSlashRedirect` in next.config.ts).
 *
 * Published sites use relative asset URLs (./style.css, ./main.js), so a site's
 * root must end with "/": /sites/<slug> → /sites/<slug>/. Every other page keeps
 * Next.js' default behaviour of removing a trailing slash.
 *
 * Uses the raw request URL: `request.nextUrl` re-applies Next's own
 * trailing-slash formatting when serialised, which would undo the change.
 */
export function proxy(request: NextRequest) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (/^\/sites\/[^/]+$/.test(pathname)) {
    url.pathname = `${pathname}/`;
    return NextResponse.redirect(url, 308);
  }
  if (pathname.startsWith("/sites/")) return NextResponse.next();
  if (pathname.length > 1 && pathname.endsWith("/")) {
    url.pathname = pathname.replace(/\/+$/, "");
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next internals, API routes and the static preview/runtime servers.
  matcher: ["/((?!_next/|api/|preview/|preview-runtime/|vendor/|favicon.ico).*)"],
};
