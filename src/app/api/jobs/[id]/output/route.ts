import { api, HttpError } from "@/server/http/api";
import { getOwnedJob } from "@/server/services/jobs";
import { storage } from "@/server/storage/storage";
import type { MediaJobOutput } from "@/server/services/media";

/** Download the media produced by a generation job (owner only). */
export const GET = api<{ id: string }>(async ({ req, user, params }) => {
  const job = await getOwnedJob(user.id, params.id);
  const out = job.output as MediaJobOutput | null;
  if (job.status !== "succeeded" || !out?.storageKey) throw new HttpError(404, "This job has no media output", "NO_OUTPUT");
  const data = await storage().get(out.storageKey);
  if (!data) throw new HttpError(404, "Output file is missing from storage", "NO_OUTPUT");
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": out.mimeType,
      "Content-Length": String(data.length),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ...(download ? { "Content-Disposition": `attachment; filename="${job.kind}-${job.id}.${out.ext}"` } : {}),
    },
  });
});
