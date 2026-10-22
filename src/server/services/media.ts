import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/server/db/client";
import { startJob } from "@/server/jobs/runner";
import { storage } from "@/server/storage/storage";
import { isProviderForKind, mediaProvider } from "@/server/media/providers";
import { HttpError } from "@/server/http/errors";
import { AIError } from "@/server/ai/types";
import type { MediaRequest } from "@/lib/media";

export function newStorageKey(ownerId: string, ext: string) {
  const owner = ownerId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return `${owner}/${randomBytes(16).toString("base64url")}.${ext.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)}`;
}

export type MediaJobOutput = { storageKey: string; mimeType: string; size: number; ext: string; metadata: Record<string, unknown> };

/**
 * Start an asynchronous media generation job. The job only succeeds when the
 * provider actually returned media and it was stored; there is no fallback
 * content.
 */
export async function startMediaJob(userId: string, req: MediaRequest) {
  if (!isProviderForKind(req.providerId, req.kind)) throw new HttpError(400, `Provider ${req.providerId} does not support ${req.kind}`, "UNSUPPORTED");
  const provider = mediaProvider(req.providerId);
  if (!provider) throw new HttpError(400, "Unknown provider", "UNSUPPORTED");
  const info = provider.info();
  if (!info.configured || !info.kinds.includes(req.kind)) throw new HttpError(409, info.reason ?? `${info.label} is not configured for ${req.kind}`, "NOT_CONFIGURED");

  return startJob<MediaJobOutput>(
    { userId, kind: req.kind, provider: info.id, model: info.model, input: req as never },
    async (ctx) => {
      ctx.emit({ type: "stage", stage: "generate", state: "start", detail: info.label });
      let out;
      try {
        out = await provider.generate(req, {
          signal: ctx.signal,
          progress: ctx.progress,
          log: (message) => ctx.emit({ type: "log", level: "info", message }),
          setExternalId: (id) => void db.generationJob.update({ where: { id: ctx.jobId }, data: { externalId: id } }).catch(() => {}),
        });
      } catch (err) {
        throw err instanceof AIError ? new Error(err.message) : err;
      }
      if (!out.data.length) throw new Error("Provider returned an empty file");
      const storageKey = newStorageKey(userId, out.ext);
      await storage().put(storageKey, out.data, out.mimeType);
      ctx.emit({ type: "stage", stage: "generate", state: "done" });
      ctx.emit({ type: "asset", assetId: "", url: `/api/jobs/${ctx.jobId}/output`, mimeType: out.mimeType });
      return { storageKey, mimeType: out.mimeType, size: out.data.length, ext: out.ext, metadata: out.metadata };
    },
  );
}

export const ASSET_TYPES = ["image", "video", "audio", "model3d", "material", "other"] as const;

export function assetTypeForMime(mime: string): (typeof ASSET_TYPES)[number] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("model/")) return "model3d";
  return "other";
}

export async function getOwnedAsset(userId: string, id: string) {
  const a = await db.asset.findFirst({ where: { id, ownerId: userId } });
  if (!a) throw new HttpError(404, "Asset not found", "NOT_FOUND");
  return a;
}
