import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { HttpError } from "@/server/http/errors";
import { decodePhpToken, ownerIdFor } from "@/server/auth/php-token";
import { createProject, getFiles, getOwnedProject, markWorkingVersion, snapshot, writeFileSet } from "@/server/services/projects";
import { buildProject } from "@/server/build/builder";
import { serializeProject } from "@/server/services/serialize";
import { audit } from "@/server/audit";
import { db } from "@/server/db/client";
import { storage } from "@/server/storage/storage";
import type { Prisma } from "@/generated/mysql-prisma/client";
import type { Framework, ProjectCategory } from "@/lib/schemas/project";

/**
 * Copy a presentation from another owner into the caller's account, as a copy
 * that stands on its own: its files, its slide pictures (deckmedia/<project>/)
 * and its thumbnail are copied, and the pictures' addresses point at the copy,
 * so the copy keeps working when the original is changed or deleted.
 *
 * Used by the PHP app (server to server) for the DFY templates: importing the
 * team's presentations into the template store, and a user's "Use this
 * template". The caller is the target account (x-access-token); the source
 * owner's access token comes in the body. Only the PHP app holds both tokens,
 * so nobody can copy another account's presentation through this route.
 * Existing routes (duplicate and the rest) are not changed by this one.
 */
const Body = z.object({
  sourceToken: z.string().min(16).max(512),
  name: z.string().trim().min(1).max(120).optional(),
});

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", json: "application/json",
};

export const POST = api<{ id: string }>(
  async ({ req, user, params, ip }) => {
    const body = await readJson(req, Body, 4096);
    const source = decodePhpToken(body.sourceToken);
    if (!source) throw new HttpError(403, "This presentation cannot be copied.", "FORBIDDEN");
    const src = await getOwnedProject(ownerIdFor(source), params.id);
    const files = await getFiles(src.id);

    // The copy first (empty), so its id is known for the pictures' new addresses.
    const p = await createProject(user.id, {
      name: (body.name ?? src.name).slice(0, 120),
      description: src.description,
      category: src.category as ProjectCategory,
      framework: src.framework as Framework,
      files: [],
    });

    // Slide pictures: copied under the copy's own folder (the listing thumbnails thumb-* are handled below).
    const from = `deckmedia/${src.id}/`, to = `deckmedia/${p.id}/`;
    let media: string[] = [];
    try {
      media = (await storage().list(`deckmedia/${src.id}`)).filter((k) => k.startsWith(from) && !/\/thumb-[^/]+$/.test(k));
    } catch (err) {
      console.error("[copy] listing the pictures failed:", err instanceof Error ? err.message : err);
    }
    // Six at a time: a presentation has a handful of pictures, and the request must stay short (hosting cuts long ones).
    const copyOne = async (key: string) => {
      const data = await storage().get(key);
      if (!data) return;
      const name = key.slice(from.length);
      const ext = (name.split(".").pop() ?? "").toLowerCase();
      await storage().put(to + name, data, MIME[ext] ?? "application/octet-stream");
    };
    for (let i = 0; i < media.length; i += 6) await Promise.all(media.slice(i, i + 6).map(copyOne));

    // The files (and the specs) with the pictures' addresses pointing at the copy.
    const swap = (text: string) => (text.includes(from) ? text.split(from).join(to) : text);
    const copied = files.map((f) => ({ path: f.path, content: swap(f.content) }));
    const spec = src.spec == null ? undefined : (JSON.parse(swap(JSON.stringify(src.spec))) as Prisma.InputJsonValue);
    const sceneSpec = src.sceneSpec == null ? undefined : (JSON.parse(swap(JSON.stringify(src.sceneSpec))) as Prisma.InputJsonValue);
    if (copied.length) {
      await writeFileSet(p.id, copied, { spec, sceneSpec });
      await snapshot(p.id, "import", { summary: "Copied from a template", files: copied });
    }
    await audit(user.id, "project.copy", { type: "project", id: p.id }, { from: src.id, media: media.length }, ip);

    // Build it at once, so it can be opened, presented and published like the original (as duplicate does).
    if (copied.length) {
      const build = await buildProject({ projectId: p.id, framework: p.framework as Framework, files: copied });
      if (build.status === "succeeded") {
        const v = await snapshot(p.id, "auto", { summary: "Copy", files: copied });
        await markWorkingVersion(p.id, v.id);
        try {
          const thumb = src.lastWorkingBuildId ? await storage().get(`deckmedia/${src.id}/thumb-${src.lastWorkingBuildId}.jpg`) : null;
          if (thumb) await storage().put(`deckmedia/${p.id}/thumb-${build.buildId}.jpg`, thumb, "image/jpeg");
        } catch {
          // No picture is not a failed copy: the editor makes one when the copy is opened.
        }
      }
    }
    const fresh = await db.project.findUnique({ where: { id: p.id } });
    return { project: serializeProject(fresh ?? p), media: media.length };
  },
  { rateLimit: { bucket: "build", perMinute: 30 } },
);
