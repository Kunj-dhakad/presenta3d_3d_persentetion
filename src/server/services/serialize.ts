import "server-only";
import type { Project } from "@/generated/prisma/client";
import { previewUrlFor } from "@/server/build/urls";

export function serializeProject(p: Project & { _count?: { files: number } }) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    framework: p.framework,
    status: p.status,
    isScene: p.sceneSpec !== null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    lastBuildStatus: p.lastBuildStatus,
    lastBuildId: p.lastBuildId,
    lastWorkingBuildId: p.lastWorkingBuildId,
    lastWorkingVersionId: p.lastWorkingVersionId,
    previewUrl: p.lastWorkingBuildId ? previewUrlFor(p.lastWorkingBuildId) : null,
    fileCount: p._count?.files ?? null,
  };
}

export type ProjectDTO = ReturnType<typeof serializeProject>;
