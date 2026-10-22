/**
 * Task orchestration: runs a DAG of agent tasks with bounded concurrency.
 *
 * Guarantees:
 *  - a task starts only after all of its dependencies succeeded
 *  - at most `concurrency` tasks run at once
 *  - two tasks that declare overlapping `writes` never run at the same time
 *    (file-level locks), and the merge step rejects undeclared overlaps
 *  - a failed dependency marks dependants "skipped" (no wasted model calls)
 *  - cancellation via AbortSignal stops scheduling and aborts running tasks
 *
 * Pure TypeScript with no I/O so it is deterministic and unit-testable.
 */

export type AgentRole = "planner" | "frontend" | "threeD" | "design" | "repair" | "reviewer";
export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";

export type TaskSpec<I = unknown> = {
  id: string;
  role: AgentRole;
  description: string;
  inputs: I;
  dependsOn: string[];
  /** Paths this task may write. Used for locking and merge validation. */
  writes: string[];
};

export type TaskState<I = unknown, O = unknown> = TaskSpec<I> & {
  status: TaskStatus;
  output: O | null;
  outputRefs: string[];
  error: string | null;
  attempts: number;
  startedAt: number | null;
  finishedAt: number | null;
};

export type TaskRunner<I, O> = (
  task: TaskState<I, O>,
  ctx: { signal: AbortSignal; results: Map<string, TaskState<I, O>> },
) => Promise<{ output: O; outputRefs: string[] }>;

export type OrchestratorEvents<I, O> = {
  onTaskUpdate?: (task: TaskState<I, O>) => void;
};

export class CycleError extends Error {}

export function validateGraph(tasks: TaskSpec[]): void {
  const ids = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.id)) throw new Error(`duplicate task id ${t.id}`);
    ids.add(t.id);
  }
  for (const t of tasks) for (const d of t.dependsOn) if (!ids.has(d)) throw new Error(`task ${t.id} depends on unknown task ${d}`);
  // Kahn's algorithm for cycle detection
  const indeg = new Map(tasks.map((t) => [t.id, t.dependsOn.length]));
  const queue = tasks.filter((t) => t.dependsOn.length === 0).map((t) => t.id);
  let seen = 0;
  while (queue.length) {
    const id = queue.shift()!;
    seen++;
    for (const t of tasks) {
      if (t.dependsOn.includes(id)) {
        indeg.set(t.id, (indeg.get(t.id) ?? 0) - 1);
        if (indeg.get(t.id) === 0) queue.push(t.id);
      }
    }
  }
  if (seen !== tasks.length) throw new CycleError("task graph contains a cycle");
}

export async function runTaskGraph<I, O>(
  specs: TaskSpec<I>[],
  runner: TaskRunner<I, O>,
  opts: { concurrency: number; signal?: AbortSignal } & OrchestratorEvents<I, O>,
): Promise<Map<string, TaskState<I, O>>> {
  validateGraph(specs);
  const states = new Map<string, TaskState<I, O>>(
    specs.map((s) => [s.id, { ...s, status: "pending", output: null, outputRefs: [], error: null, attempts: 0, startedAt: null, finishedAt: null }]),
  );
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);
  const locked = new Set<string>();
  const running = new Map<string, Promise<void>>();
  const emit = (t: TaskState<I, O>) => opts.onTaskUpdate?.({ ...t });

  const canStart = (t: TaskState<I, O>) =>
    t.status === "pending" && t.dependsOn.every((d) => states.get(d)!.status === "succeeded") && t.writes.every((w) => !locked.has(w));

  const propagateSkips = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of states.values()) {
        if (t.status !== "pending") continue;
        const dead = t.dependsOn.find((d) => ["failed", "skipped", "cancelled"].includes(states.get(d)!.status));
        if (dead) {
          t.status = "skipped";
          t.error = `dependency ${dead} did not succeed`;
          t.finishedAt = Date.now();
          emit(t);
          changed = true;
        }
      }
    }
  };

  try {
    for (;;) {
      if (controller.signal.aborted) {
        for (const t of states.values()) {
          if (t.status === "pending") {
            t.status = "cancelled";
            t.finishedAt = Date.now();
            emit(t);
          }
        }
        await Promise.allSettled(running.values());
        break;
      }
      propagateSkips();
      for (const t of states.values()) {
        if (running.size >= opts.concurrency) break;
        if (!canStart(t)) continue;
        t.status = "running";
        t.attempts++;
        t.startedAt = Date.now();
        for (const w of t.writes) locked.add(w);
        emit(t);
        const p = runner(t, { signal: controller.signal, results: states })
          .then(({ output, outputRefs }) => {
            t.output = output;
            t.outputRefs = outputRefs;
            t.status = controller.signal.aborted ? "cancelled" : "succeeded";
          })
          .catch((err: unknown) => {
            t.status = controller.signal.aborted ? "cancelled" : "failed";
            t.error = err instanceof Error ? err.message : String(err);
          })
          .finally(() => {
            t.finishedAt = Date.now();
            for (const w of t.writes) locked.delete(w);
            running.delete(t.id);
            emit(t);
          });
        running.set(t.id, p);
      }
      if (running.size === 0) {
        const pending = [...states.values()].some((t) => t.status === "pending");
        if (!pending) break;
        // Pending tasks that can never start (should be impossible after validateGraph + skips).
        propagateSkips();
        if (![...states.values()].some((t) => t.status === "pending")) break;
        throw new Error("orchestrator deadlock: pending tasks cannot be scheduled");
      }
      await Promise.race(running.values());
    }
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
  return states;
}

/**
 * Merge per-task file outputs in deterministic (task declaration) order.
 *
 * - A path declared by one task can only be written by that task.
 * - With `allowUndeclared`, a task may also add a path that no task declared
 *   (e.g. a helper module); the first task in declaration order claims it.
 * - Every rejected write is reported in `conflicts`; accepted writes are kept,
 *   so one misbehaving agent cannot discard the others' work.
 */
export function mergeTaskOutputs<T extends { path: string }, I = unknown>(
  order: string[],
  states: Map<string, TaskState<I, T[]>>,
  opts: { allowUndeclared?: boolean } = {},
): { merged: T[]; conflicts: string[] } {
  const declaredBy = new Map<string, string>();
  for (const id of order) for (const w of states.get(id)?.writes ?? []) if (!declaredBy.has(w)) declaredBy.set(w, id);
  const owner = new Map<string, string>();
  const conflicts: string[] = [];
  const merged: T[] = [];
  for (const id of order) {
    const t = states.get(id);
    if (!t || t.status !== "succeeded" || !t.output) continue;
    for (const item of t.output) {
      const declarer = declaredBy.get(item.path);
      if (declarer && declarer !== id) {
        conflicts.push(`${id} tried to write ${item.path}, which belongs to ${declarer}`);
        continue;
      }
      if (!declarer && !opts.allowUndeclared) {
        conflicts.push(`${id} wrote undeclared path ${item.path}`);
        continue;
      }
      const prev = owner.get(item.path);
      if (prev && prev !== id) {
        conflicts.push(`${item.path} written by both ${prev} and ${id}; kept ${prev}`);
        continue;
      }
      owner.set(item.path, id);
      merged.push(item);
    }
  }
  return { merged, conflicts };
}
