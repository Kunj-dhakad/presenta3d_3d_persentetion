import { z } from "zod";
import { db } from "@/server/db/client";
import { api, HttpError, readJson } from "@/server/http/api";
import { storage } from "@/server/storage/storage";
import { getOwnedAsset } from "@/server/services/media";
import { audit } from "@/server/audit";

type P = { id: string };

/** Serve an asset's bytes to its owner. */
export const GET = api<P>(async ({ req, user, params }) => {
  const a = await getOwnedAsset(user.id, params.id);
  const data = await storage().get(a.storageKey);
  if (!data) throw new HttpError(404, "Asset file is missing from storage", "NOT_FOUND");
  const download = new URL(req.url).searchParams.get("download") === "1";
  const ext = a.storageKey.split(".").pop();
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": a.mimeType,
      "Content-Length": String(data.length),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ...(download ? { "Content-Disposition": `attachment; filename="${a.name.replace(/[^\w.-]+/g, "_").slice(0, 80)}.${ext}"` } : {}),
    },
  });
});

const Patch = z.object({ name: z.string().trim().min(1).max(120) });

export const PATCH = api<P>(async ({ req, user, params }) => {
  await getOwnedAsset(user.id, params.id);
  const { name } = await readJson(req, Patch, 1024);
  const a = await db.asset.update({ where: { id: params.id }, data: { name } });
  return { asset: { id: a.id, name: a.name } };
});

export const DELETE = api<P>(async ({ user, params, ip }) => {
  const a = await getOwnedAsset(user.id, params.id);
  await db.asset.delete({ where: { id: a.id } });
  // Generated outputs may still back their job's preview; only delete bytes of uploads or when no job references them.
  const stillReferenced = a.jobId ? await db.generationJob.count({ where: { id: a.jobId } }) : 0;
  if (!stillReferenced) await storage().delete(a.storageKey).catch(() => {});
  await audit(user.id, "asset.delete", { type: "asset", id: a.id }, undefined, ip);
  return { ok: true };
});
