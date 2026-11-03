"use client";

import { getAccessToken } from "@/lib/api-client";
import { getParentSite } from "@/components/embed/parent-bridge";

/**
 * Calls to the PHP app (CI_Core) that embeds this one, for data it owns, such
 * as the presenter settings of the 3D viewer (Presentation3d_view_controller).
 * Sent as a plain form POST with the access token in the body: a "simple"
 * cross-origin request (no preflight), which the PHP server allows from any
 * origin; the token, not a cookie, says who is asking.
 */
const TIMEOUT_MS = 20_000;

export class PhpApiError extends Error {}

export async function phpPost<T>(
  path: string,
  fields: Record<string, string | number | boolean | null | undefined>,
  { timeoutMs = TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<T> {
  const site = getParentSite();
  const token = getAccessToken();
  if (!site || !token) throw new PhpApiError("Open this presentation from your dashboard to change these settings.");

  const body = new URLSearchParams({ access_token: token });
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    body.append(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(site + path, { method: "POST", body, signal: controller.signal });
  } catch (e) {
    throw new PhpApiError((e as Error).name === "AbortError" ? "The request took too long. Please try again." : "Could not reach the server. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => null)) as ({ status?: number; message?: string } & T) | null;
  if (!res.ok || !data || data.status !== 1) throw new PhpApiError(data?.message || `Request failed (${res.status}).`);
  return data;
}
