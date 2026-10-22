import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { createProject, deleteProject, duplicateProject, getFiles, getOwnedProject, restoreVersion, snapshot, writeFileSet } from "@/server/services/projects";
import { getOwnedCanvas, saveCanvas } from "@/server/services/canvas";
import { createShareLink, resolveShareToken } from "@/server/services/share";
import { emptyCanvas, makeNode } from "@/lib/schemas/canvas";
import { createUser } from "../support/helpers";

describe("project persistence", () => {
  it("creates, saves, reopens and duplicates projects", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "Site", category: "website", framework: "vanilla", files: [{ path: "index.html", content: "<h1>v1</h1>" }] });
    await writeFileSet(p.id, [
      { path: "index.html", content: "<h1>v2</h1>" },
      { path: "app.js", content: "console.log(1)" },
    ]);
    // Reopen: a fresh read returns exactly what was saved.
    expect(await getFiles(p.id)).toEqual([
      { path: "app.js", content: "console.log(1)" },
      { path: "index.html", content: "<h1>v2</h1>" },
    ]);
    // Files removed from the set are deleted.
    await writeFileSet(p.id, [{ path: "index.html", content: "<h1>v3</h1>" }]);
    expect((await getFiles(p.id)).map((f) => f.path)).toEqual(["index.html"]);
    const copy = await duplicateProject(u.id, p.id);
    expect(copy.id).not.toBe(p.id);
    expect(await getFiles(copy.id)).toEqual(await getFiles(p.id));
  });

  it("validates paths and limits on save", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "x", category: "website", framework: "vanilla" });
    await expect(writeFileSet(p.id, [{ path: "../x.js", content: "" }])).rejects.toThrow(/relative segments/);
    await expect(writeFileSet(p.id, [{ path: "A.js", content: "" }, { path: "a.js", content: "" }])).rejects.toThrow(/Duplicate/);
  });

  it("enforces ownership: other users get the same 404 as a missing project", async () => {
    const owner = await createUser();
    const other = await createUser();
    const p = await createProject(owner.id, { name: "private", category: "website", framework: "vanilla" });
    await expect(getOwnedProject(other.id, p.id)).rejects.toMatchObject({ status: 404 });
    await expect(getOwnedProject(other.id, "does-not-exist")).rejects.toMatchObject({ status: 404 });
    await expect(deleteProject(other.id, p.id)).rejects.toMatchObject({ status: 404 });
    await expect(duplicateProject(other.id, p.id)).rejects.toMatchObject({ status: 404 });
    expect((await getOwnedProject(owner.id, p.id)).id).toBe(p.id);
  });
});

describe("version history", () => {
  it("skips redundant snapshots, keeps checkpoints and restores reversibly", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "v", category: "website", framework: "vanilla", files: [{ path: "a.js", content: "1" }] });
    const s1 = await snapshot(p.id, "auto");
    expect(s1.created).toBe(false); // identical to the initial import snapshot
    const cp = await snapshot(p.id, "checkpoint", { label: "Named" });
    expect(cp.created).toBe(true); // named checkpoints are always kept
    await writeFileSet(p.id, [{ path: "a.js", content: "2" }, { path: "b.js", content: "new" }]);
    const s2 = await snapshot(p.id, "auto");
    expect(s2.created).toBe(true);

    const r = await restoreVersion(p.id, cp.id);
    expect(r.files).toEqual([{ path: "a.js", content: "1" }]);
    expect(await getFiles(p.id)).toEqual([{ path: "a.js", content: "1" }]);
    // The pre-restore state was snapshotted, so the restore can be undone.
    await restoreVersion(p.id, s2.id);
    expect((await getFiles(p.id)).map((f) => f.content)).toEqual(["2", "new"]);
    const kinds = (await db.projectVersion.findMany({ where: { projectId: p.id }, orderBy: { createdAt: "asc" } })).map((v) => v.kind);
    expect(kinds).toContain("restore");
  });

  it("refuses versions from other projects", async () => {
    const u = await createUser();
    const a = await createProject(u.id, { name: "a", category: "website", framework: "vanilla", files: [{ path: "a.js", content: "1" }] });
    const b = await createProject(u.id, { name: "b", category: "website", framework: "vanilla", files: [{ path: "b.js", content: "1" }] });
    const va = await db.projectVersion.findFirstOrThrow({ where: { projectId: a.id } });
    await expect(restoreVersion(b.id, va.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("canvas persistence", () => {
  it("saves with optimistic concurrency and keeps version history", async () => {
    const u = await createUser();
    const doc = emptyCanvas();
    const c = await db.canvasDocument.create({ data: { ownerId: u.id, name: "c", data: doc } });
    doc.pages[0].nodes.push(makeNode("frame", "f1"));
    const r1 = await saveCanvas(u.id, c.id, doc, 0);
    expect(r1).toBe(1);
    // A second tab still holding revision 0 must not overwrite.
    expect(await saveCanvas(u.id, c.id, emptyCanvas(), 0)).toBeNull();
    const stored = await getOwnedCanvas(u.id, c.id);
    expect((stored.data as typeof doc).pages[0].nodes).toHaveLength(1);
    expect(await db.canvasVersion.count({ where: { canvasId: c.id } })).toBe(1);
    const other = await createUser();
    await expect(getOwnedCanvas(other.id, c.id)).rejects.toMatchObject({ status: 404 });
    expect(await saveCanvas(other.id, c.id, doc, 1)).toBeNull();
  });
});

describe("share links", () => {
  it("resolves valid tokens, and stops resolving after revoke or expiry", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "shared", category: "website", framework: "vanilla" });
    const { link, token } = await createShareLink(p.id, u.id, 7);
    const stored = await db.shareLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(stored.tokenHash).not.toContain(token); // only a hash is stored
    expect((await resolveShareToken(token))?.projectId).toBe(p.id);
    expect(await resolveShareToken(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(await resolveShareToken("../../etc")).toBeNull();
    await db.shareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
    expect(await resolveShareToken(token)).toBeNull();
    const exp = await createShareLink(p.id, u.id, 1);
    await db.shareLink.update({ where: { id: exp.link.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resolveShareToken(exp.token)).toBeNull();
  });
});
