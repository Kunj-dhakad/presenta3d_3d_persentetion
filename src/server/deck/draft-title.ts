import "server-only";
import { z } from "zod";
import type { TextModelProvider } from "@/server/ai/types";
import { draftNameFrom } from "@/lib/draft-name";

const TitleSchema = z.object({ title: z.string() });

/** Longest the AI title may take before the prompt's own words are used (the user is waiting). */
const TITLE_TIMEOUT_MS = 5000;

/**
 * The name a new presentation shows while its slides are written: a short,
 * professional title written by the AI from the request (not the request
 * itself). The deck's own title replaces it when the slides are ready.
 * Falls back to the prompt's topic (draftNameFrom) when the AI is slow or fails.
 */
export async function aiDraftTitle(provider: TextModelProvider, prompt: string, userId: string): Promise<string> {
  const fallback = draftNameFrom(prompt);
  try {
    const res = await provider.structured({
      operation: "draft-title",
      schema: TitleSchema,
      schemaName: "presentation_title",
      system: [
        "You name presentations. Write one short, professional title for the presentation described by the user.",
        "2 to 6 words, title case, no quotes, no emoji, no trailing full stop, no words like 'Presentation' or 'Slides'.",
        "Write it in the language the presentation is asked to be written in (English when none is asked).",
        "Return only the title.",
      ].join(" "),
      input: prompt.slice(0, 2000),
      maxOutputTokens: 60,
      reasoningEffort: "minimal",
      signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
      userId,
    });
    const title = cleanTitle(res.data.title);
    return title || fallback;
  } catch {
    return fallback;
  }
}

/** One line, no wrapping quotes or final full stop, at most 80 characters. */
export function cleanTitle(raw: string): string {
  let t = String(raw ?? "").replace(/\s+/g, " ").trim();
  t = t.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "").replace(/[.。]+$/, "").trim();
  if (t.length > 80) t = t.slice(0, 80).replace(/\s+\S*$/, "").trim() + "…";
  return t;
}
