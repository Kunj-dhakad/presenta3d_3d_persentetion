import { describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { createProject } from "@/server/services/projects";
import { activeProjectJob, reconcileOrphanedJob, startJob, subscribe } from "@/server/jobs/runner";
import type { JobEvent } from "@/lib/jobs";
import { createUser, waitForJob } from "../support/helpers";

describe("job runner", () => {
  it("saves the final status before announcing it, so a follow-up prompt is not refused", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "deck", category: "presentation", framework: "three" });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const jobId = await startJob({ userId: u.id, projectId: p.id, kind: "project-generate", provider: "mock", input: {} }, async () => {
      await gate;
      return { ok: true };
    });

    const seen = new Promise<{ status: string | undefined; active: unknown }>((resolve) => {
      subscribe(jobId, (e: JobEvent) => {
        if (e.type === "status" && e.status === "succeeded") {
          // What a client sending its next prompt at this moment would find.
          void Promise.all([db.generationJob.findUnique({ where: { id: jobId } }), activeProjectJob(p.id)]).then(([row, active]) => resolve({ status: row?.status, active }));
        }
      });
    });
    expect(await activeProjectJob(p.id)).toMatchObject({ id: jobId });
    // A remote database (RDS): every write takes a while.
    const update = db.generationJob.update.bind(db.generationJob);
    const slow = vi.spyOn(db.generationJob, "update").mockImplementation(((args: Parameters<typeof update>[0]) =>
      new Promise((r) => setTimeout(r, 150)).then(() => update(args))) as never);
    try {
      release();
      expect(await seen).toEqual({ status: "succeeded", active: null });
      await waitForJob(jobId);
    } finally {
      slow.mockRestore();
    }
  });

  it("frees the project quickly when a job stopped without finishing", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "deck", category: "presentation", framework: "three" });
    const job = await db.generationJob.create({
      data: { userId: u.id, projectId: p.id, kind: "project-generate", provider: "mock", input: {}, status: "running", events: [] },
    });
    // Still heartbeating recently: considered alive.
    expect(await activeProjectJob(p.id)).toMatchObject({ id: job.id });
    // Silent for two minutes (no heartbeat): the server that ran it is gone.
    await db.generationJob.update({ where: { id: job.id }, data: { updatedAt: new Date(Date.now() - 2 * 60_000) } });
    expect(await activeProjectJob(p.id)).toBeNull();
    const after = await reconcileOrphanedJob(await db.generationJob.findUniqueOrThrow({ where: { id: job.id } }));
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/Interrupted/);
  });
});
