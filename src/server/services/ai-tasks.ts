import "server-only";
import { getTextProvider } from "@/server/ai/provider";
import { startJob } from "@/server/jobs/runner";
import { env } from "@/server/env";
import { SceneSpecSchema, validateScene, type SceneSpec } from "@/lib/schemas/scene";
import { AiFrameContentSchema, type AiFrameContent } from "@/lib/schemas/canvas";
import { CANVAS_SYSTEM, SCENE_SYSTEM } from "@/server/pipeline/prompts";
import { runTaskGraph, type TaskSpec } from "@/server/orchestrator/orchestrator";
import { AIError } from "@/server/ai/types";

/** Generate or edit a 3D scene specification; the result is validated before it is returned. */
export async function startSceneJob(userId: string, input: { prompt: string; current: SceneSpec | null }) {
  const provider = getTextProvider();
  return startJob<{ scene: SceneSpec; summary: string }>(
    { userId, kind: "scene", provider: provider.name, model: provider.model, input: { prompt: input.prompt, editing: Boolean(input.current) } },
    async (ctx) => {
      ctx.emit({ type: "stage", stage: "generate", state: "start", detail: input.current ? "Editing scene" : "Designing scene" });
      const ask = async (extra: string) =>
        (
          await provider.structured({
            operation: input.current ? "scene.edit" : "scene.generate",
            schema: SceneSpecSchema,
            schemaName: "scene_spec",
            system: SCENE_SYSTEM,
            input: [
              input.current ? `Current scene (modify it according to the request, keep ids of unchanged objects stable):\n${JSON.stringify(input.current).slice(0, 120_000)}` : "",
              `User request:\n${input.prompt}`,
              extra,
            ]
              .filter(Boolean)
              .join("\n\n"),
            maxOutputTokens: 32_000,
            signal: ctx.signal,
            userId,
            jobId: ctx.jobId,
            onProgress: (chars) => ctx.emit({ type: "stream", taskId: "scene", chars }),
          })
        ).data;
      let draft = await ask("");
      let v = validateScene(draft);
      if (!v.ok) {
        ctx.emit({ type: "stage", stage: "repair", state: "start", detail: v.errors.slice(0, 3).join("; ") });
        draft = await ask(`Your previous scene was invalid:\n${v.errors.join("\n")}\nReturn a corrected, complete scene.`);
        v = validateScene(draft);
        if (!v.ok) throw new Error(`The generated scene is invalid: ${v.errors.slice(0, 5).join("; ")}`);
        ctx.emit({ type: "stage", stage: "repair", state: "done" });
      }
      ctx.emit({ type: "stage", stage: "generate", state: "done", detail: `${v.scene.objects.length} objects` });
      return { scene: v.scene, summary: `${v.scene.title}: ${v.scene.objects.length} objects, ${v.scene.lights.length} lights.` };
    },
  );
}

export type FrameRequest = { id: string; name: string; w: number; h: number; existing: string };

/** Generate content for several canvas frames as independent, concurrently running agent tasks. */
export async function startCanvasJob(userId: string, input: { canvasId: string; instruction: string; frames: FrameRequest[] }) {
  const provider = getTextProvider();
  return startJob<{ frames: { frameId: string; content: AiFrameContent | null; error: string | null }[] }>(
    { userId, kind: "canvas", provider: provider.name, model: provider.model, input: { canvasId: input.canvasId, instruction: input.instruction, frames: input.frames.map((f) => f.id) } },
    async (ctx) => {
      const tasks: TaskSpec<FrameRequest>[] = input.frames.map((f) => ({
        id: `frame-${f.id}`,
        role: "design",
        description: `Design frame "${f.name}" (${Math.round(f.w)}×${Math.round(f.h)})`,
        inputs: f,
        dependsOn: [],
        writes: [`frame:${f.id}`],
      }));
      ctx.emit({ type: "plan", tasks: tasks.map((t) => ({ id: t.id, role: t.role, description: t.description, status: "pending", dependsOn: [], writes: t.writes, error: null, outputRefs: [] })) });
      let done = 0;
      const states = await runTaskGraph<FrameRequest, AiFrameContent>(
        tasks,
        async (task, { signal }) => {
          const f = task.inputs;
          const { data } = await provider.structured({
            operation: "canvas.frame",
            schema: AiFrameContentSchema,
            schemaName: "frame_content",
            system: CANVAS_SYSTEM,
            input: `Frame "${f.name}" is ${Math.round(f.w)}px wide and ${Math.round(f.h)}px tall.\n${f.existing ? `Current content:\n${f.existing}\n` : ""}User request:\n${input.instruction}`,
            maxOutputTokens: 8_000,
            signal,
            userId,
            jobId: ctx.jobId,
          });
          // Clamp to the frame so generated nodes never land outside it.
          const nodes = data.nodes.slice(0, 60).map((n) => {
            const w = Math.max(1, Math.min(n.w, f.w));
            const h = Math.max(1, Math.min(n.h, f.h));
            return { ...n, w, h, x: Math.max(0, Math.min(n.x, f.w - w)), y: Math.max(0, Math.min(n.y, f.h - h)), opacity: Math.max(0, Math.min(1, n.opacity)) };
          });
          done++;
          ctx.progress(done / tasks.length);
          return { output: { ...data, nodes }, outputRefs: [`frame:${f.id}`] };
        },
        {
          concurrency: env().AGENT_CONCURRENCY,
          signal: ctx.signal,
          onTaskUpdate: (t) => ctx.emit({ type: "task", task: { id: t.id, role: t.role, description: t.description, status: t.status, dependsOn: [], writes: t.writes, error: t.error, outputRefs: t.outputRefs } }),
        },
      );
      const frames = input.frames.map((f) => {
        const s = states.get(`frame-${f.id}`)!;
        return { frameId: f.id, content: s.status === "succeeded" ? s.output : null, error: s.error };
      });
      if (frames.every((f) => !f.content)) throw new AIError("UPSTREAM", frames[0]?.error ?? "No frame could be generated");
      return { frames };
    },
  );
}
