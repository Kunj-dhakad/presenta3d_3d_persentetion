import "server-only";
import { db } from "@/server/db/client";
import { notFound, badRequest } from "@/server/http/errors";
import { filesDigest } from "@/server/vfs/digest";
import { VFS_LIMITS, assertProjectPath, byteLength } from "@/lib/vfs/paths";
import type { ProjectCategory, Framework } from "@/lib/schemas/project";
import { removeProjectBuilds } from "@/server/build/builder";
import type { Prisma } from "@/generated/prisma/client";

export type FileSet = { path: string; content: string }[];

/** Ownership check used by every project route. Missing and foreign projects are indistinguishable (404). */
export async function getOwnedProject(userId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, ownerId: userId } });
  if (!p) throw notFound("Project");
  return p;
}

export function validateFileSet(files: FileSet): FileSet {
  if (files.length > VFS_LIMITS.maxFiles) throw badRequest(`A project can contain at most ${VFS_LIMITS.maxFiles} files`);
  const seen = new Set<string>();
  let total = 0;
  const out: FileSet = [];
  for (const f of files) {
    const path = assertProjectPath(f.path);
    const key = path.toLowerCase();
    if (seen.has(key)) throw badRequest(`Duplicate path: ${path}`);
    seen.add(key);
    const size = byteLength(f.content);
    if (size > VFS_LIMITS.maxFileBytes) throw badRequest(`${path} exceeds ${VFS_LIMITS.maxFileBytes / 1024} KB`);
    total += size;
    out.push({ path, content: f.content });
  }
  if (total > VFS_LIMITS.maxProjectBytes) throw badRequest(`Project exceeds ${VFS_LIMITS.maxProjectBytes / 1024 / 1024} MB`);
  return out;
}

export async function getFiles(projectId: string): Promise<FileSet> {
  const rows = await db.projectFile.findMany({ where: { projectId }, orderBy: { path: "asc" }, select: { path: true, content: true } });
  return rows;
}

/** Replace the project's file set atomically. */
export async function writeFileSet(projectId: string, files: FileSet) {
  const valid = validateFileSet(files);
  const keep = valid.map((f) => f.path);
  await db.$transaction([
    db.projectFile.deleteMany({ where: { projectId, path: { notIn: keep } } }),
    ...valid.map((f) =>
      db.projectFile.upsert({
        where: { projectId_path: { projectId, path: f.path } },
        create: { projectId, path: f.path, content: f.content, size: byteLength(f.content) },
        update: { content: f.content, size: byteLength(f.content) },
      }),
    ),
    db.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } }),
  ]);
}

export type VersionKind = "auto" | "checkpoint" | "pre-ai" | "ai" | "restore" | "import";

/**
 * Create a snapshot. Unnamed snapshots are skipped when the content is
 * identical to the latest snapshot, so autosave never piles up duplicates.
 */
export async function snapshot(projectId: string, kind: VersionKind, opts: { label?: string; summary?: string; files?: FileSet } = {}) {
  const files = opts.files ?? (await getFiles(projectId));
  const digest = filesDigest(files);
  if (kind !== "checkpoint") {
    const last = await db.projectVersion.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { id: true, digest: true } });
    if (last?.digest === digest) return { id: last.id, created: false };
  }
  const v = await db.projectVersion.create({
    data: {
      projectId,
      kind,
      label: opts.label ?? null,
      summary: opts.summary ?? null,
      files: files as unknown as Prisma.InputJsonValue,
      fileCount: files.length,
      digest,
    },
    select: { id: true },
  });
  await pruneAutoVersions(projectId);
  return { id: v.id, created: true };
}

/** Bound the number of automatic snapshots; named checkpoints and the working version are kept. */
async function pruneAutoVersions(projectId: string, keep = 40) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { lastWorkingVersionId: true } });
  const autos = await db.projectVersion.findMany({
    where: { projectId, kind: { in: ["auto", "pre-ai", "ai", "restore"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
    skip: keep,
  });
  const ids = autos.map((a) => a.id).filter((id) => id !== project?.lastWorkingVersionId);
  if (ids.length) await db.projectVersion.deleteMany({ where: { id: { in: ids } } });
}

export async function markWorkingVersion(projectId: string, versionId: string) {
  await db.$transaction([
    db.projectVersion.update({ where: { id: versionId }, data: { isWorking: true } }),
    db.project.update({ where: { id: projectId }, data: { lastWorkingVersionId: versionId } }),
  ]);
}

export async function getVersion(projectId: string, versionId: string) {
  const v = await db.projectVersion.findFirst({ where: { id: versionId, projectId } });
  if (!v) throw notFound("Version");
  return { ...v, files: v.files as unknown as FileSet };
}

/** Restore a version. The current state is snapshotted first so the restore itself can be undone. */
export async function restoreVersion(projectId: string, versionId: string) {
  const v = await getVersion(projectId, versionId);
  await snapshot(projectId, "auto", { summary: "Before restore" });
  await writeFileSet(projectId, v.files);
  const s = await snapshot(projectId, "restore", { summary: `Restored ${v.label ?? v.createdAt.toISOString()}`, files: v.files });
  return { restoredFrom: v.id, versionId: s.id, files: v.files };
}

export async function createProject(
  ownerId: string,
  input: { name: string; description?: string; category: ProjectCategory; framework: Framework; files?: FileSet; spec?: unknown; sceneSpec?: unknown },
) {
  const files = validateFileSet(input.files ?? []);
  const project = await db.project.create({
    data: {
      ownerId,
      name: input.name.slice(0, 120),
      description: (input.description ?? "").slice(0, 2000),
      category: input.category,
      framework: input.framework,
      spec: (input.spec as Prisma.InputJsonValue) ?? undefined,
      sceneSpec: (input.sceneSpec as Prisma.InputJsonValue) ?? undefined,
      files: { create: files.map((f) => ({ path: f.path, content: f.content, size: byteLength(f.content) })) },
    },
  });
  if (files.length) await snapshot(project.id, "import", { summary: "Initial version", files });
  return project;
}

export async function duplicateProject(ownerId: string, projectId: string) {
  const src = await getOwnedProject(ownerId, projectId);
  const files = await getFiles(projectId);
  return createProject(ownerId, {
    name: `${src.name} (copy)`.slice(0, 120),
    description: src.description,
    category: src.category as ProjectCategory,
    framework: src.framework as Framework,
    files,
    spec: src.spec ?? undefined,
    sceneSpec: src.sceneSpec ?? undefined,
  });
}

export async function deleteProject(ownerId: string, projectId: string) {
  await getOwnedProject(ownerId, projectId);
  await removeProjectBuilds(projectId);
  await db.project.delete({ where: { id: projectId } });
}
