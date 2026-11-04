import { z } from "zod";
import { api, readJson, badRequest } from "@/server/http/api";
import { db } from "@/server/db/client";
import { getOwnedProject } from "@/server/services/projects";
import { storage } from "@/server/storage/storage";

const Body = z.object({
  buildId: z.string().regex(/^[A-Za-z0-9_-]{8,58}$/),
  /** A JPEG data URL of slide 1, drawn by the presentation itself (runtime: captureThumbnail). */
  image: z.string().startsWith("data:image/jpeg;base64,").max(600_000),
});

/**
 * POST /api/projects/:id/thumbnail { buildId, image }: store a picture of a
 * build's first slide as deckmedia/<project>/thumb-<buildId>.jpg (public, like
 * the deck itself). The PHP presentation listing shows it for the project's
 * last working build; one per build, so it is never stale.
 */
export const POST = api<{ id: string }>(
  async ({ req, user, params }) => {
    const p = await getOwnedProject(user.id, params.id);
    const { buildId, image } = await readJson(req, Body, 700_000);
    const build = await db.build.findFirst({ where: { id: buildId, projectId: p.id, status: "succeeded" }, select: { id: true } });
    if (!build) throw badRequest("Unknown build");
    const data = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
    // A real JPEG (SOI marker), of a sensible size.
    if (data.length < 1024 || data.length > 400_000 || data[0] !== 0xff || data[1] !== 0xd8) throw badRequest("Invalid thumbnail");
    await storage().put(`deckmedia/${p.id}/thumb-${buildId}.jpg`, data, "image/jpeg");
    return { ok: true };
  },
  { rateLimit: { bucket: "thumbnail", perMinute: 20 } },
);
