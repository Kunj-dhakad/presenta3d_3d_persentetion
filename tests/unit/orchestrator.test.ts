import { describe, expect, it } from "vitest";
import { CycleError, mergeTaskOutputs, runTaskGraph, validateGraph, type TaskSpec } from "@/server/orchestrator/orchestrator";

const t = (id: string, dependsOn: string[] = [], writes: string[] = [id]): TaskSpec<null> => ({ id, role: "frontend", description: id, inputs: null, dependsOn, writes });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("task orchestration", () => {
  it("runs independent tasks concurrently up to the limit", async () => {
    let active = 0;
    let peak = 0;
    await runTaskGraph([t("a"), t("b"), t("c"), t("d"), t("e")], async () => {
      active++;
      peak = Math.max(peak, active);
      await sleep(20);
      active--;
      return { output: null, outputRefs: [] };
    }, { concurrency: 2 });
    expect(peak).toBe(2);
  });

  it("respects dependencies", async () => {
    const order: string[] = [];
    await runTaskGraph([t("entry", ["a", "b"]), t("a"), t("b")], async (task) => {
      await sleep(task.id === "a" ? 30 : 5);
      order.push(task.id);
      return { output: null, outputRefs: [] };
    }, { concurrency: 4 });
    expect(order.at(-1)).toBe("entry");
  });

  it("skips dependants of failed tasks instead of running them", async () => {
    const ran: string[] = [];
    const states = await runTaskGraph([t("a"), t("b", ["a"]), t("c", ["b"]), t("d")], async (task) => {
      ran.push(task.id);
      if (task.id === "a") throw new Error("boom");
      return { output: null, outputRefs: [] };
    }, { concurrency: 2 });
    expect(states.get("a")!.status).toBe("failed");
    expect(states.get("a")!.error).toBe("boom");
    expect(states.get("b")!.status).toBe("skipped");
    expect(states.get("c")!.status).toBe("skipped");
    expect(states.get("d")!.status).toBe("succeeded");
    expect(ran.sort()).toEqual(["a", "d"]);
  });

  it("never runs two tasks that write the same path at once", async () => {
    const writing = new Set<string>();
    let overlap = false;
    await runTaskGraph([t("a", [], ["x.js"]), t("b", [], ["x.js"]), t("c", [], ["y.js"])], async (task) => {
      for (const w of task.writes) {
        if (writing.has(w)) overlap = true;
        writing.add(w);
      }
      await sleep(15);
      for (const w of task.writes) writing.delete(w);
      return { output: null, outputRefs: [] };
    }, { concurrency: 3 });
    expect(overlap).toBe(false);
  });

  it("cancels pending and running tasks", async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 20);
    const states = await runTaskGraph([t("a"), t("b", ["a"])], async (_task, { signal }) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 500);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
      return { output: null, outputRefs: [] };
    }, { concurrency: 1, signal: ctrl.signal });
    expect(states.get("a")!.status).toBe("cancelled");
    expect(["cancelled", "skipped"]).toContain(states.get("b")!.status);
  });

  it("rejects cycles and unknown dependencies", () => {
    expect(() => validateGraph([t("a", ["b"]), t("b", ["a"])])).toThrow(CycleError);
    expect(() => validateGraph([t("a", ["zzz"])])).toThrow(/unknown task/);
    expect(() => validateGraph([t("a"), t("a")])).toThrow(/duplicate/);
  });

  it("merges outputs deterministically and reports ownership conflicts", async () => {
    const states = await runTaskGraph<null, { path: string }[]>(
      [t("one", [], ["a.js"]), t("two", [], ["b.js"])],
      async (task) => ({ output: task.id === "one" ? [{ path: "a.js" }, { path: "helper.js" }] : [{ path: "b.js" }, { path: "a.js" }, { path: "helper.js" }], outputRefs: [] }),
      { concurrency: 2 },
    );
    const { merged, conflicts } = mergeTaskOutputs(["one", "two"], states, { allowUndeclared: true });
    expect(merged.map((m) => m.path)).toEqual(["a.js", "helper.js", "b.js"]);
    expect(conflicts.join("\n")).toMatch(/two tried to write a\.js, which belongs to one/);
    expect(conflicts.join("\n")).toMatch(/helper\.js written by both one and two/);
    expect(mergeTaskOutputs(["one"], states).conflicts.join()).toMatch(/undeclared path helper\.js/);
  });
});
