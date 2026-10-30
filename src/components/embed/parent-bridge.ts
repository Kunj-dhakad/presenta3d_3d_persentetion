"use client";

/**
 * This app runs inside the PHP app's (CI_Core) iframe — its 3D presentation
 * pages (application/views/default/presentation3d/*.php). They talk with
 * window.postMessage, like the slide editor does:
 *
 *   iframe → PHP   REACT_READY          the page is listening
 *   PHP → iframe   INIT_DATA            { token, URL, branding? }  (the user's access token, PHP base URL,
 *                                       the business's whitelabel { logo, name, link } for footer branding)
 *   iframe → PHP   LOADER_OFF           the page is up; PHP hides its loader
 *   iframe → PHP   P3D_OPENED           { projectId }  a presentation was created or opened
 *   iframe → PHP   P3D_BACK             back to PHP's list of 3D presentations
 *
 * Opened directly (no parent page) the token can come as ?token= instead,
 * which is handy in development.
 */

let parentOrigin = "*";
/** The PHP app's base URL (INIT_DATA's URL), ending with "/". */
let parentSite = "";

export type ParentBranding = { logo: string; name: string; link: string };
/** The business's whitelabel branding (INIT_DATA's branding): the Design panel's default footer. */
let parentBranding: ParentBranding | null = null;

export function setParentBranding(value: unknown) {
  if (!value || typeof value !== "object") return;
  const b = value as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 1000) : "");
  parentBranding = { logo: str(b.logo), name: str(b.name), link: str(b.link) };
}

export function getParentBranding(): ParentBranding | null {
  return parentBranding;
}

/** In-app paths of the embedded pages. */
export const paths = {
  create: "/embed/new",
  workspace: (projectId: string) => `/embed/p/${projectId}`,
  present: (projectId: string) => `/embed/present/${projectId}`,
};

/** NEXT_PUBLIC_PARENT_ORIGINS: comma-separated origins, `https://*.example.com` allowed. Empty allows any (development). */
export function allowedParentOrigin(origin: string) {
  const list = (process.env.NEXT_PUBLIC_PARENT_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return true;
  return list.some((rule) => {
    if (!rule.includes("*")) return rule === origin;
    const pattern = new RegExp("^" + rule.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[a-z0-9-]+") + "$", "i");
    return pattern.test(origin);
  });
}

export function inIframe() {
  return typeof window !== "undefined" && window.parent !== window;
}

export function setParentOrigin(origin: string) {
  parentOrigin = origin;
}

export function setParentSite(url: string) {
  parentSite = url && !url.endsWith("/") ? url + "/" : url;
}

/**
 * The link to share for a published site. A site published here
 * (/sites/<slug>/) is shown on the PHP app's own page, 3d-view/<slug>.
 */
export function publicLink(url: string | null): string | null {
  if (!url) return null;
  const site = url.match(/^\/sites\/([^/]+)\/?$/);
  if (site && parentSite) return `${parentSite}3d-view/${site[1]}`;
  return url.startsWith("/") ? `${window.location.origin}${url}` : url;
}

export function notifyParent(type: string, data: Record<string, unknown> = {}) {
  if (!inIframe()) return;
  window.parent.postMessage({ type, ...data }, parentOrigin);
}
