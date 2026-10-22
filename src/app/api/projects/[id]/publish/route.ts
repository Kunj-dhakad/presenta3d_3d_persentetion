import { db } from "@/server/db/client";
import { api } from "@/server/http/api";
import { getOwnedProject } from "@/server/services/projects";
import { deploymentProvider, publishProject, siteUrl, unpublishProject } from "@/server/publish/publish";
import { audit } from "@/server/audit";
import { storage } from "@/server/storage/storage";


type P = { id: string };

export const GET = api<P>(async ({ user, params }) => {
  await getOwnedProject(user.id, params.id);
  const provider = deploymentProvider();
  const deployments = await db.deployment.findMany({ where: { projectId: params.id }, orderBy: { createdAt: "desc" }, take: 20 });
  return {
    provider: { id: provider.id, isPublic: provider.isPublic, storage: storage().driver, ...provider.configured() },
    deployments: deployments.map((d) => ({ id: d.id, status: d.status, url: siteUrl(d), provider: d.provider, isPublic: d.isPublic, error: d.error, createdAt: d.createdAt, updatedAt: d.updatedAt })),
  };
});

/** Publish (or re-publish) the last successful build. */
export const POST = api<P>(
  async ({ user, params, ip }) => {
    await getOwnedProject(user.id, params.id);
    const d = await publishProject(params.id);
    await audit(user.id, "project.publish", { type: "project", id: params.id }, { status: d.status, provider: d.provider }, ip);
    return { deployment: { id: d.id, status: d.status, url: siteUrl(d), provider: d.provider, isPublic: d.isPublic, error: d.error } };
  },
  { rateLimit: { bucket: "publish", perMinute: 6 } },
);

export const DELETE = api<P>(async ({ user, params, ip }) => {
  await getOwnedProject(user.id, params.id);
  const n = await unpublishProject(params.id);
  await audit(user.id, "project.unpublish", { type: "project", id: params.id }, { count: n }, ip);
  return { unpublished: n };
});
