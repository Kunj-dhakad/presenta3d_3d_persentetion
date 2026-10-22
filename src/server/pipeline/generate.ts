import "server-only";
import { db } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/server/env";
import type { JobContext } from "@/server/jobs/runner";
import { AIError, type TextModelProvider } from "@/server/ai/types";
import {
  EditPlanSchema,
  FileOperationsResultSchema,
  ProjectSpecSchema,
  type EditPlan,
  type FileOperation,
  type Framework,
  type ProjectSpec,
} from "@/lib/schemas/project";
import { applyOperations, diffStats, fromFileMap, toFileMap, type FileChange, type FileMap } from "@/lib/vfs/apply";
import { getFiles, markWorkingVersion, snapshot, writeFileSet } from "@/server/services/projects";
import { buildProject } from "@/server/build/builder";
import { formatDiagnostic, type BuildDiagnostic, type BuildSummary } from "@/lib/build-types";
import { mergeTaskOutputs, runTaskGraph, type TaskSpec, type TaskState } from "@/server/orchestrator/orchestrator";
import type { TaskEventPayload } from "@/lib/jobs";
import { normalizeSpec, tasksFromSpec, type GenerationTaskInput } from "./spec";
import { reviewProject } from "./review";
import { EDITOR_SYSTEM, EDIT_PLANNER_SYSTEM, PLANNER_SYSTEM, REPAIR_SYSTEM, generatorSystem, specSummary } from "./prompts";

export type PipelineInput = {
  userId: string;
  projectId: string;
  conversationId: string;
  prompt: string;
  mode: "auto" | "repair";
  runtimeErrors?: string[];
};

export type PipelineResult = {
  summary: string;
  changedFiles: string[];
  preVersionId: string | null;
  postVersionId: string | null;
  buildStatus: "succeeded" | "failed" | "skipped";
  buildId: string | null;
  previewUrl: string | null;
  assistantMessageId: string;
};

const CONTEXT_BUDGET = 90_000; // characters of existing code sent with edit / repair requests

function taskPayload(t: TaskState<unknown, unknown> | TaskSpec<unknown>): TaskEventPayload {
  const s = t as TaskState<unknown, unknown>;
  return {
    id: t.id,
    role: t.role,
    description: t.description,
    status: s.status ?? "pending",
    dependsOn: t.dependsOn,
    writes: t.writes,
    error: s.error ?? null,
    outputRefs: s.outputRefs ?? [],
  };
}

function fileTree(files: FileMap): string {
  return [...files.entries()].map(([p, c]) => `${p} (${c.length} chars)`).join("\n");
}

function withBudget(files: FileMap, paths: string[], budget = CONTEXT_BUDGET): string {
  let used = 0;
  const parts: string[] = [];
  for (const p of paths) {
    const c = files.get(p);
    if (c === undefined) continue;
    if (used + c.length > budget) {
      parts.push(`=== ${p} === (omitted: context budget reached)`);
      continue;
    }
    used += c.length;
    parts.push(`=== ${p} ===\n${c}`);
  }
  return parts.join("\n\n");
}

async function conversationContext(conversationId: string): Promise<string> {
  const msgs = await db.chatMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: 9, select: { role: true, content: true } });
  return msgs
    .slice(1) // the newest is the current request, sent separately
    .reverse()
    .map((m) => `${m.role}: ${m.content.slice(0, 600)}`)
    .join("\n");
}

/** Run one structured generation call, with one retry for retryable failures. */
async function callWithRetry<T>(fn: () => Promise<T>, ctx: JobContext, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AIError && err.retryable && err.code !== "TRUNCATED" && !ctx.signal.aborted) {
      ctx.emit({ type: "log", level: "warn", message: `${label}: ${err.message}. Retrying once.` });
      return fn();
    }
    throw err;
  }
}

// ─── Stage implementations ───────────────────────────────────────────────

async function planNewProject(ctx: JobContext, provider: TextModelProvider, input: PipelineInput, history: string): Promise<ProjectSpec> {
  ctx.emit({ type: "stage", stage: "understand", state: "start" });
  const { data } = await callWithRetry(
    () =>
      provider.structured({
        operation: "plan.spec",
        schema: ProjectSpecSchema,
        schemaName: "project_spec",
        system: PLANNER_SYSTEM,
        input: `${history ? `Conversation so far:\n${history}\n\n` : ""}User request:\n${input.prompt}`,
        maxOutputTokens: 8_000,
        signal: ctx.signal,
        userId: input.userId,
        jobId: ctx.jobId,
      }),
    ctx,
    "Planner",
  );
  const { spec, warnings } = normalizeSpec(data);
  for (const w of warnings) ctx.emit({ type: "log", level: "warn", message: w });
  ctx.emit({ type: "understanding", text: spec.understanding, title: spec.title, category: spec.category, framework: spec.framework });
  ctx.emit({ type: "stage", stage: "understand", state: "done", detail: `${spec.files.length} files planned` });
  return spec;
}

async function generateFiles(
  ctx: JobContext,
  provider: TextModelProvider,
  input: PipelineInput,
  spec: ProjectSpec,
): Promise<{ ops: FileOperation[]; failed: string[] }> {
  const tasks = tasksFromSpec(spec);
  ctx.emit({ type: "stage", stage: "plan", state: "done", detail: `${tasks.length} agent tasks` });
  ctx.emit({ type: "plan", tasks: tasks.map(taskPayload) });
  ctx.emit({ type: "stage", stage: "generate", state: "start" });
  const summary = specSummary(spec);
  let done = 0;

  const runOne = async (files: GenerationTaskInput["files"], role: string, taskId: string, others: string, signal: AbortSignal) => {
    const { data } = await callWithRetry(
      () =>
        provider.structured({
          operation: `generate.${role}`,
          schema: FileOperationsResultSchema,
          schemaName: "file_operations",
          system: generatorSystem(role),
          input: [
            `User request:\n${input.prompt}`,
            `Project specification:\n${summary}`,
            others ? `Files already written by other agents (integrate with them exactly):\n${others}` : "",
            `ASSIGNED_FILES: ${files.map((f) => f.path).join(", ")}`,
            `Write these files now:\n${files.map((f) => `- ${f.path}: ${f.purpose}. Contract: ${f.exports || "(none)"}`).join("\n")}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          maxOutputTokens: 32_000,
          signal,
          userId: input.userId,
          jobId: ctx.jobId,
          onProgress: (chars) => ctx.emit({ type: "stream", taskId, chars }),
        }),
      ctx,
      taskId,
    );
    return data;
  };

  const states = await runTaskGraph<GenerationTaskInput, FileOperation[]>(
    tasks,
    async (task, { signal, results }) => {
      // The entry group sees the files other agents produced so wiring matches real exports.
      const produced: FileMap = new Map();
      for (const dep of task.dependsOn) for (const op of results.get(dep)?.output ?? []) produced.set(op.path, op.content);
      const others = withBudget(produced, [...produced.keys()], 60_000);
      const want = task.inputs.files;
      let ops: FileOperation[] = [];
      try {
        const r = await runOne(want, task.role, task.id, others, signal);
        ops = r.operations;
      } catch (err) {
        if (err instanceof AIError && err.code === "TRUNCATED" && want.length > 1) {
          ctx.emit({ type: "log", level: "warn", message: `${task.id}: output was truncated; generating its files one at a time` });
          for (const f of want) ops.push(...(await runOne([f], task.role, task.id, others, signal)).operations);
        } else throw err;
      }
      // Ask once more for any assigned file the agent did not return.
      const missing = want.filter((f) => !ops.some((o) => o.path === f.path && o.content.trim().length > 0));
      if (missing.length) {
        ctx.emit({ type: "log", level: "warn", message: `${task.id}: missing ${missing.map((m) => m.path).join(", ")}; requesting again` });
        ops.push(...(await runOne(missing, task.role, task.id, others, signal)).operations);
      }
      const accepted = ops
        .filter((o) => o.operation === "create" || o.operation === "replace")
        .map((o) => ({ ...o, path: o.path.replace(/^\.\//, ""), operation: "create" as const }));
      done++;
      ctx.progress(0.1 + 0.5 * (done / tasks.length));
      return { output: accepted, outputRefs: accepted.map((o) => o.path) };
    },
    {
      concurrency: env().AGENT_CONCURRENCY,
      signal: ctx.signal,
      onTaskUpdate: (t) => ctx.emit({ type: "task", task: taskPayload(t) }),
    },
  );

  const order = tasks.map((t) => t.id);
  const { merged, conflicts } = mergeTaskOutputs(order, states, { allowUndeclared: true });
  for (const c of conflicts) ctx.emit({ type: "log", level: "warn", message: `merge: ${c}` });
  const failed = [...states.values()].filter((t) => t.status !== "succeeded").map((t) => `${t.id}: ${t.error ?? t.status}`);
  ctx.emit({ type: "stage", stage: "generate", state: failed.length ? "failed" : "done", detail: `${merged.length} files` });
  return { ops: merged, failed };
}

async function planEdit(ctx: JobContext, provider: TextModelProvider, input: PipelineInput, files: FileMap, history: string): Promise<EditPlan> {
  ctx.emit({ type: "stage", stage: "understand", state: "start" });
  // Inspect the project: tree plus as much source as fits the budget, entry/app files first.
  const ordered = [...files.keys()].sort((a, b) => score(b) - score(a));
  function score(p: string) {
    return (/index\.html|main\.|App\./.test(p) ? 10 : 0) + (/\.(tsx?|jsx?|css|html)$/.test(p) ? 5 : 0) - files.get(p)!.length / 20000;
  }
  const { data } = await callWithRetry(
    () =>
      provider.structured({
        operation: "plan.edit",
        schema: EditPlanSchema,
        schemaName: "edit_plan",
        system: EDIT_PLANNER_SYSTEM,
        input: [
          history ? `Conversation so far:\n${history}` : "",
          `File tree:\n${fileTree(files)}`,
          `File contents:\n${withBudget(files, ordered, 70_000)}`,
          `User request:\n${input.prompt}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        maxOutputTokens: 6_000,
        signal: ctx.signal,
        userId: input.userId,
        jobId: ctx.jobId,
      }),
    ctx,
    "Edit planner",
  );
  ctx.emit({ type: "understanding", text: data.understanding });
  ctx.emit({ type: "stage", stage: "understand", state: "done", detail: `${data.targets.length} files to change` });
  return { ...data, targets: data.targets.slice(0, 16) };
}

async function applyEdit(ctx: JobContext, provider: TextModelProvider, input: PipelineInput, files: FileMap, plan: EditPlan): Promise<{ ops: FileOperation[]; failed: string[] }> {
  // Chunk targets into independent tasks (max 3 files each) that may run in parallel.
  const chunks: EditPlan["targets"][] = [];
  for (const t of plan.targets) {
    const last = chunks[chunks.length - 1];
    if (last && last.length < 3) last.push(t);
    else chunks.push([t]);
  }
  const tasks: TaskSpec<EditPlan["targets"]>[] = chunks.map((c, i) => ({
    id: `edit-${i + 1}`,
    role: c.some((t) => /three|scene|3d|r3f/i.test(t.path + t.instructions)) ? "threeD" : c.every((t) => t.path.endsWith(".css")) ? "design" : "frontend",
    description: c.map((t) => `${t.action} ${t.path}`).join(", "),
    inputs: c,
    dependsOn: [],
    writes: c.map((t) => t.path),
  }));
  ctx.emit({ type: "stage", stage: "plan", state: "done", detail: `${tasks.length} edit tasks` });
  ctx.emit({ type: "plan", tasks: tasks.map(taskPayload) });
  ctx.emit({ type: "stage", stage: "generate", state: "start" });
  const tree = fileTree(files);
  let done = 0;
  const states = await runTaskGraph<EditPlan["targets"], FileOperation[]>(
    tasks,
    async (task, { signal }) => {
      const targetPaths = task.inputs.map((t) => t.path);
      // Context: the target files plus the entry files they most likely interact with.
      const related = [...files.keys()].filter((p) => !targetPaths.includes(p) && /(^|\/)(index\.html|main\.\w+|App\.\w+)$/.test(p));
      const { data } = await callWithRetry(
        () =>
          provider.structured({
            operation: `edit.${task.role}`,
            schema: FileOperationsResultSchema,
            schemaName: "edit_operations",
            system: EDITOR_SYSTEM,
            input: [
              `User request:\n${input.prompt}`,
              `Change summary:\n${plan.summary}`,
              `File tree:\n${tree}`,
              `Instructions:\n${task.inputs.map((t) => `- ${t.action} ${t.path}: ${t.instructions}`).join("\n")}`,
              `ASSIGNED_FILES: ${targetPaths.join(", ")}`,
              `Current contents of the files to change:\n${withBudget(files, targetPaths, 70_000) || "(new files)"}`,
              related.length ? `Related files (read-only context):\n${withBudget(files, related, 20_000)}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
            maxOutputTokens: 24_000,
            signal,
            userId: input.userId,
            jobId: ctx.jobId,
            onProgress: (chars) => ctx.emit({ type: "stream", taskId: task.id, chars }),
          }),
        ctx,
        task.id,
      );
      done++;
      ctx.progress(0.1 + 0.5 * (done / tasks.length));
      const ops = data.operations.map((o) => ({ ...o, path: o.path.replace(/^\.\//, "") }));
      return { output: ops, outputRefs: ops.map((o) => o.path) };
    },
    { concurrency: env().AGENT_CONCURRENCY, signal: ctx.signal, onTaskUpdate: (t) => ctx.emit({ type: "task", task: taskPayload(t) }) },
  );
  const { merged, conflicts } = mergeTaskOutputs(tasks.map((t) => t.id), states, { allowUndeclared: true });
  for (const c of conflicts) ctx.emit({ type: "log", level: "warn", message: `merge: ${c}` });
  const failed = [...states.values()].filter((t) => t.status !== "succeeded").map((t) => `${t.id}: ${t.error ?? t.status}`);
  ctx.emit({ type: "stage", stage: "generate", state: failed.length ? "failed" : "done", detail: `${merged.length} operations` });
  return { ops: merged, failed };
}

async function repairOnce(
  ctx: JobContext,
  provider: TextModelProvider,
  input: PipelineInput,
  files: FileMap,
  problems: string[],
  attempt: number,
): Promise<FileOperation[]> {
  const mentioned = [...files.keys()].filter((p) => problems.some((e) => e.includes(p)));
  const entry = [...files.keys()].filter((p) => /(^|\/)(index\.html|main\.\w+|App\.\w+)$/.test(p));
  const context = [...new Set([...mentioned, ...entry, ...files.keys()])];
  const { data } = await callWithRetry(
    () =>
      provider.structured({
        operation: "repair",
        schema: FileOperationsResultSchema,
        schemaName: "repair_operations",
        system: REPAIR_SYSTEM,
        input: [
          `Original user request:\n${input.prompt}`,
          `Repair attempt ${attempt}. Problems to fix:\n${problems.map((p) => `- ${p}`).join("\n")}`,
          `File tree:\n${fileTree(files)}`,
          `Current files:\n${withBudget(files, context, 80_000)}`,
        ].join("\n\n"),
        maxOutputTokens: 24_000,
        signal: ctx.signal,
        userId: input.userId,
        jobId: ctx.jobId,
        onProgress: (chars) => ctx.emit({ type: "stream", taskId: `repair-${attempt}`, chars }),
      }),
    ctx,
    "Repair",
  );
  return data.operations.map((o) => ({ ...o, path: o.path.replace(/^\.\//, "") }));
}

// ─── Orchestration of the whole pipeline ─────────────────────────────────

export async function runProjectPipeline(ctx: JobContext, provider: TextModelProvider, input: PipelineInput): Promise<PipelineResult> {
  const project = await db.project.findUniqueOrThrow({ where: { id: input.projectId } });
  let files = toFileMap(await getFiles(input.projectId));
  let framework = project.framework as Framework;
  const history = await conversationContext(input.conversationId);
  const changes = new Map<string, FileChange>();
  const maxRepairs = env().MAX_REPAIR_ATTEMPTS;

  // Checkpoint: the pre-change state is always recoverable.
  const pre = files.size ? await snapshot(input.projectId, "pre-ai", { summary: `Before: ${input.prompt.slice(0, 100)}` }) : null;

  const record = (list: FileChange[]) => {
    for (const c of list) {
      const prev = changes.get(c.path);
      changes.set(c.path, prev ? { ...c, before: prev.before, kind: prev.before === null ? (c.after === null ? "deleted" : "created") : c.after === null ? "deleted" : "modified" } : c);
    }
  };
  const applyAndPersist = async (ops: FileOperation[], label: string) => {
    const r = applyOperations(files, ops);
    if (!r.ok) {
      // Fall back to the operations that are individually valid so one bad hunk does not drop everything.
      for (const e of r.errors) ctx.emit({ type: "log", level: "warn", message: `${label}: ${e}` });
      const good: FileOperation[] = [];
      let acc = files;
      for (const op of ops) {
        const single = applyOperations(acc, [op]);
        if (single.ok) {
          acc = single.files;
          good.push(op);
        }
      }
      const r2 = applyOperations(files, good);
      if (!r2.ok) return { applied: 0, problems: r.errors };
      files = r2.files;
      record(r2.changes);
      await writeFileSet(input.projectId, fromFileMap(files));
      for (const c of r2.changes) ctx.emit({ type: "file", path: c.path, kind: c.kind, ...diffStats(c.before, c.after) });
      return { applied: r2.changes.length, problems: r.errors };
    }
    files = r.files;
    record(r.changes);
    await writeFileSet(input.projectId, fromFileMap(files));
    for (const c of r.changes) ctx.emit({ type: "file", path: c.path, kind: c.kind, ...diffStats(c.before, c.after) });
    return { applied: r.changes.length, problems: [] as string[] };
  };

  let summaryText = "";
  let problems: string[] = [];
  let expected: string[] = [];

  if (input.mode === "repair") {
    ctx.emit({ type: "understanding", text: "Fixing the reported preview errors." });
    problems = (input.runtimeErrors ?? []).slice(0, 20);
    summaryText = "Attempted a targeted fix for the reported errors.";
  } else if (files.size === 0) {
    const spec = await planNewProject(ctx, provider, input, history);
    framework = spec.framework;
    expected = spec.files.map((f) => f.path);
    await db.project.update({
      where: { id: input.projectId },
      data: {
        name: project.name === "Untitled project" ? spec.title : project.name,
        description: project.description || spec.goal.slice(0, 500),
        category: spec.category,
        framework: spec.framework,
        spec: spec as unknown as Prisma.InputJsonValue,
      },
    });
    const gen = await generateFiles(ctx, provider, input, spec);
    if (!gen.ops.length) throw new Error(`Generation produced no files${gen.failed.length ? `: ${gen.failed.join("; ")}` : ""}`);
    const r = await applyAndPersist(gen.ops, "generate");
    problems.push(...r.problems, ...gen.failed.map((f) => `generation task failed: ${f}`));
    summaryText = spec.understanding;
  } else {
    const plan = await planEdit(ctx, provider, input, files, history);
    const edit = await applyEdit(ctx, provider, input, files, plan);
    const r = await applyAndPersist(edit.ops, "edit");
    problems.push(...r.problems);
    if (r.applied === 0 && !r.problems.length && !edit.failed.length) ctx.emit({ type: "log", level: "warn", message: "The model returned no changes." });
    if (edit.failed.length) problems.push(...edit.failed.map((f) => `edit task failed: ${f}`));
    summaryText = plan.summary;
  }

  // Deterministic reviewer: checks the merged result before spending a build.
  ctx.emit({ type: "stage", stage: "review", state: "start" });
  const review = reviewProject(files, framework, expected);
  for (const w of review.warnings) ctx.emit({ type: "log", level: "warn", message: `review: ${w}` });
  ctx.emit({ type: "stage", stage: "review", state: review.errors.length ? "failed" : "done", detail: review.errors.length ? `${review.errors.length} issues` : "ok" });
  problems.push(...review.errors);

  // Build → repair loop (bounded).
  let build: BuildSummary | null = null;
  let attempt = 0;
  const doBuild = async () => {
    ctx.emit({ type: "stage", stage: "build", state: "start" });
    const b = await buildProject({ projectId: input.projectId, framework, files: fromFileMap(files) });
    ctx.emit({ type: "build", status: b.status === "succeeded" ? "succeeded" : "failed", buildId: b.buildId, previewUrl: b.previewUrl, errors: b.errors, warnings: b.warnings, attempt });
    ctx.emit({ type: "stage", stage: "build", state: b.status === "succeeded" ? "done" : "failed", detail: b.status === "succeeded" ? `${b.durationMs} ms` : `${b.errors.length} errors` });
    return b;
  };

  if (files.size) {
    // Normal mode: build first, repair only while the build fails.
    // Repair mode (runtime errors from the preview): at least one repair pass, then rebuild.
    if (input.mode !== "repair") build = await doBuild();
    const limit = input.mode === "repair" ? Math.max(1, maxRepairs) : maxRepairs;
    while (attempt < limit && !ctx.signal.aborted) {
      const needsRepair = input.mode === "repair" ? build === null || build.status === "failed" : build?.status === "failed";
      if (!needsRepair) break;
      const issues = [...(build?.status === "failed" ? build.errors.map(formatDiagnostic) : []), ...problems];
      attempt++;
      ctx.emit({ type: "stage", stage: "repair", state: "start", detail: `attempt ${attempt} of ${limit}` });
      try {
        const ops = await repairOnce(ctx, provider, input, files, issues, attempt);
        const r = await applyAndPersist(ops, `repair ${attempt}`);
        problems = r.problems;
        ctx.emit({ type: "stage", stage: "repair", state: r.applied ? "done" : "failed", detail: `${r.applied} files changed` });
      } catch (err) {
        if (ctx.signal.aborted) break;
        ctx.emit({ type: "stage", stage: "repair", state: "failed", detail: err instanceof Error ? err.message : "repair failed" });
        problems = [];
      }
      build = await doBuild();
    }
  }

  ctx.emit({ type: "stage", stage: "finalize", state: "start" });
  const changedFiles = [...changes.keys()];
  const post = changedFiles.length ? await snapshot(input.projectId, "ai", { summary: summaryText.slice(0, 300) || input.prompt.slice(0, 100) }) : null;
  if (post && build?.status === "succeeded") await markWorkingVersion(input.projectId, post.id);
  const buildStatus: PipelineResult["buildStatus"] = build ? (build.status === "succeeded" ? "succeeded" : "failed") : "skipped";

  const lines = [summaryText || "Done."];
  if (changedFiles.length) lines.push(`Changed ${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"}.`);
  if (buildStatus === "failed") {
    const errs = (build?.errors ?? []).slice(0, 3).map(formatDiagnostic);
    lines.push(
      `The build still fails after ${attempt} repair attempt${attempt === 1 ? "" : "s"}${errs.length ? `: ${errs.join("; ")}` : ""}. The preview shows the last working version; you can ask for another fix or revert.`,
    );
  } else if (buildStatus === "succeeded" && attempt > 0) lines.push(`Fixed build issues automatically (${attempt} repair pass${attempt === 1 ? "" : "es"}).`);

  const message = await db.chatMessage.create({
    data: {
      conversationId: input.conversationId,
      role: "assistant",
      content: lines.join(" "),
      meta: {
        jobId: ctx.jobId,
        changedFiles: [...changes.values()].map((c) => ({ path: c.path, kind: c.kind, ...diffStats(c.before, c.after) })),
        preVersionId: pre?.id ?? null,
        postVersionId: post?.id ?? null,
        buildStatus,
        buildId: build?.buildId ?? null,
        repairAttempts: attempt,
      } as Prisma.InputJsonValue,
    },
  });
  await db.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } });
  const result: PipelineResult = {
    summary: lines.join(" "),
    changedFiles,
    preVersionId: pre?.id ?? null,
    postVersionId: post?.id ?? null,
    buildStatus,
    buildId: build?.buildId ?? null,
    previewUrl: build?.previewUrl ?? null,
    assistantMessageId: message.id,
  };
  ctx.emit({ type: "result", ...result });
  ctx.emit({ type: "stage", stage: "finalize", state: "done" });
  return result;
}

export type { BuildDiagnostic };
