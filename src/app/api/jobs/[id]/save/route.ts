import { z } from "zod";
import { db } from "@/server/db/client";
import { api, HttpError, readJson } from "@/server/http/api";
import { getOwnedJob } from "@/server/services/jobs";
import type { MediaJobOutput } from "@/server/services/media";
import { assetTypeForMime } from "@/server/services/media";
import { audit } from "@/server/audit";

const Body = z.object({ name: z.string().trim().min(1).max(120).optional() });

/** Save a generation job's output to the asset library. Idempotent per job. */
export const POST = api<{ id: string }>(async ({ req, user, params, ip }) => {
  const job = await getOwnedJob(user.id, params.id);
  const out = job.output as MediaJobOutput | null;
  if (job.status !== "succeeded" || !out?.storageKey) throw new HttpError(409, "Only successful media jobs can be saved", "NO_OUTPUT");
  const body = await readJson(req, Body, 2048).catch(() => ({ name: undefined }));
  const existing = await db.asset.findFirst({ where: { jobId: job.id, ownerId: user.id } });
  if (existing) return { asset: existing };
  const input = job.input as { prompt?: string; kind?: string };
  const asset = await db.asset.create({
    data: {
      ownerId: user.id,
      jobId: job.id,
      name: body.name ?? (input.prompt ?? job.kind).slice(0, 80),
      type: job.kind === "material" ? "material" : job.kind === "model3d" ? "model3d" : assetTypeForMime(out.mimeType),
      mimeType: out.mimeType,
      size: out.size,
      storageKey: out.storageKey,
      source: "generated",
      prompt: input.prompt?.slice(0, 4000) ?? null,
      provider: job.provider,
      metadata: { ...out.metadata, model: job.model } as never,
    },
  });
  await audit(user.id, "asset.save_generated", { type: "asset", id: asset.id }, { jobId: job.id }, ip);
  return { asset };
});
