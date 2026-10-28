"use client";

import { api } from "./api-client";
import { paths } from "@/components/embed/parent-bridge";

/**
 * Create a presentation and queue its generation in one request. Returns the
 * workspace URL to open; the workspace follows the job right away (?job=).
 */
export async function createPresentation(prompt: string): Promise<string> {
  const r = await api<{ projectId: string; jobId: string }>("/api/presentations", { method: "POST", json: { prompt } });
  return `${paths.workspace(r.projectId)}?job=${encodeURIComponent(r.jobId)}`;
}
