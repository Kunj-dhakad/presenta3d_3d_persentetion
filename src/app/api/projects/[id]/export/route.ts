import { api } from "@/server/http/api";
import { getFiles, getOwnedProject } from "@/server/services/projects";
import { createZip } from "@/server/vfs/zip";

/** Download the project source as a .zip archive. */
export const GET = api<{ id: string }>(async ({ user, params }) => {
  const p = await getOwnedProject(user.id, params.id);
  const files = await getFiles(p.id);
  const zip = createZip(files.map((f) => ({ path: f.path, data: Buffer.from(f.content, "utf8") })));
  const name = p.name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "project";
  return new Response(new Uint8Array(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}.zip"`, "Cache-Control": "no-store" },
  });
});
