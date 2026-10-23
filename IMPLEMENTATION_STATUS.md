# Implementation status

_Last updated: 2026-10-21. Verified on Windows 11, Node 24.18.0, npm 11.16.0, Next.js 16.4.2._

## Verified results (this build)

| Check | Command | Result |
| --- | --- | --- |
| TypeScript (strict) | `npm run typecheck` | ✅ 0 errors |
| ESLint (Next + React Compiler rules) | `npm run lint` | ✅ 0 problems |
| AI schema strictness | `npm run check:schemas` | ✅ 4/4 strict |
| Unit + integration tests | `npm test` | ✅ **126 passed** in 11 files |
| End-to-end acceptance | `npm run build && npm run test:e2e` | ✅ **6 passed** (Chromium, production build) |
| Production build | `npm run build` | ✅ no errors, no warnings |
| Live OpenAI tests | `npm run test:openai` | ⏭️ **skipped: no OPENAI_API_KEY in this environment** |

### Final acceptance checklist (from the brief)

| # | Requirement | Status |
| --- | --- | --- |
| 1 | App starts | ✅ dev and production servers verified |
| 2 | User enters a real prompt | ✅ e2e |
| 3 | Server calls the configured OpenAI API | ⚠️ **Implemented, not verified live.** The OpenAI service is tested against the real SDK with scripted HTTP/SSE responses (request shape, streaming, structured parsing, usage, retries, error mapping). No API key was available here, so `npm run test:openai` is ready but has not been run. |
| 4 | AI generates a valid multi-file project | ✅ via the offline test provider; same pipeline as OpenAI |
| 5 | Files appear in the code editor | ✅ e2e |
| 6 | Renders in a separate live preview | ✅ e2e (sandboxed, opaque origin, interactive) |
| 7 | Modify through chat | ✅ e2e (targeted patch) |
| 8 | Preview updates after edits | ✅ e2e (chat edit and manual edit with autosave) |
| 9 | Saved and reopened | ✅ e2e (reload) |
| 10 | AI-generated interactive 3D scene works | ✅ e2e (scene generated via the AI endpoint with the test provider) |
| 11 | Inspect and modify scene parameters | ✅ e2e (color, name, persistence, undo) |
| 12 | Secrets never reach browser code | ✅ unit (static scan) + e2e (sentinel key checked in every response) |
| 13 | Errors shown honestly and recoverably | ✅ unit + e2e (build failure → repair; failed repairs keep the last working build) |
| 14 | Automated tests run | ✅ |
| 15 | Production build succeeds | ✅ |

**To complete #3 yourself:** put `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env`, then run `npm run test:openai`. It performs one structured call plus a generate-then-edit project run, which costs a few cents.

---

## Working features

**Foundation.** Next.js 16 App Router; Cache Components with Suspense boundaries for runtime data; strict TypeScript; Tailwind v4 + shadcn/ui; original "3D Presentation" identity and logo; dark-first design system; navigation rail with app switcher, activity notifications, contextual help and account menu; mobile bottom navigation; landing page.

**Auth.** Local single-user mode (default in development, refused in production). Accounts mode: email/password with scrypt, DB sessions, HttpOnly cookies, CSRF origin checks, rate limits and an audit log.

**Chat (code generation).** New-chat page with prompts, four runnable example projects and blank starters. Workspace:
- project/conversation sidebar, chat with live pipeline progress (stages, agent tasks, streamed output size, file changes, build attempts, warnings) and stop/cancel
- per-message change lists with **Review changes** (diff), keep, per-file revert and reject-all
- AI-not-configured warning; jobs resume after reload

**Generation engine.** Request classification and ProjectSpec (structured output); spec normalization; task DAG with parallel agents (frontend / 3D / design roles), file locks and deterministic merge; deterministic reviewer; the file-operation contract (create / replace / patch / delete); edit planner with targeted patches; bounded repair loop for build errors and preview runtime errors; truncation and missing-file recovery; pre- and post-change checkpoints; "last working" pointers.

**Editor.** Self-hosted Monaco:
- file tree with create, rename/move and delete (with confirmation); tabs with dirty indicators
- find, replace, format, undo and redo; project-wide search; build errors as editor markers; cross-file TypeScript diagnostics
- Ctrl+S save, debounced autosave, auto-rebuild

**Preview.**
- isolated build worker with esbuild, validation (syntax, imports, packages, HTML references, unsafe patterns) and an allowlisted local runtime
- CSP-sandboxed opaque-origin serving; desktop/tablet/mobile viewports; refresh; open in a new tab
- build and runtime error panels with "Fix with AI"; stale-preview banner that keeps the last successful build

**Versions.** Automatic snapshots skip identical content; named checkpoints; compare any version with the current files (diff); restore the whole project or individual files; restores are themselves reversible.

**3D Studio.**
- R3F renderer: 14 object types, hierarchy (parents, orbits), materials, five light types, shadows, fog, grid and ground, local light-former reflection presets, labels, text billboards, particles, starfield, procedural terrain
- selection with transform gizmos (move, rotate, scale); inspector for object, light and scene; hierarchy with visibility toggles
- add, duplicate and delete; undo/redo; deterministic timeline (play, pause, scrub, speed, loop)
- play mode: interactions (hover highlight, click to focus, click to toggle motion) and a playable WASD game with collisions and a HUD
- FPS, draw-call and triangle overlay; WebGL detection fallback; error boundary; autosave with validation
- AI generation and AI edits of the SceneSpec (validated, with one repair pass)
- export to a standalone three.js code project; JSON download
- 7 working templates: solar system, product showcase, futuristic city, abstract sculpture, particle flow, portfolio hero, orb collector game

**Canvas.**
- infinite pan and zoom; frames, sections, text, rectangles, ellipses, images (from the asset library or upload), YouTube/Vimeo embeds, live project previews
- selection, multi-select and marquee; drag with alignment guides and snapping; resize handles; alignment tools; grouping and ungrouping; layer ordering; duplicate and delete; lock and hide
- undo/redo; pages; autosave with revision-conflict detection; version history with restore; JSON export and import
- AI generation of several selected frames as parallel orchestrated tasks with progress and cancel

**Studio (media).** Image, video, speech, sound effect, 3D model and material tools: provider selection, format controls, async job status and progress, preview (image, video, audio, GLB viewer), retry, cancel, save to library, download, recent history. OpenAI adapters cover images, materials, speech and Sora video; Meshy covers 3D models; ElevenLabs covers sound effects. Unconfigured providers explain exactly which variable to set and never fake results.

**Projects.** Grid and list views, search, category and status filters, generated category thumbnails, rename, duplicate, archive/unarchive, delete with confirmation, last-modified times, and empty, loading and error states.

**Assets.** Upload (drag-and-drop, MIME allowlist plus magic-byte check), type filters, search, preview, rename, download, delete.

**Publishing and sharing.** Publish the last working build as a self-contained site (runtime copied in); re-publish keeps the URL; unpublish; deployment status and errors. The local provider is clearly labelled non-public; the Vercel provider gives public URLs. Read-only share links: hashed tokens, expiry and revoke; the public share page shows code and preview. Projects download as a zip.

**Settings.** Integration status without secrets; usage table with tokens, latency, request IDs and estimated cost.

**Data.** Prisma 7 RDS MySQL schema covering every model plus Session, Build, CanvasVersion, Deployment and AuditLog; isolated SQLite unit-test fixtures; idempotent seed.

---

## Limitations (honest list)

1. **Live OpenAI not exercised here** (no key available). See acceptance item #3.
2. **External media adapters untested live.** OpenAI video/image/TTS, Meshy and ElevenLabs follow their public APIs but have not been exercised against the live services in this environment. The S3 storage adapter's SigV4 signer is verified against AWS's documented test vector; uploads to a real bucket are untested. The Vercel deploy adapter is untested without a token.
3. **Single-instance runtime.** The job runner, rate limiter and preview/site files live in one process and on local disk. Horizontal scaling needs a queue (Redis/BullMQ), a shared rate limiter and object storage for previews (see README → Scaling). Jobs interrupted by a restart are marked failed, not resumed.
4. **Preview isolation is process-level, not a container.** The build worker never executes generated code and runs with a scrubbed environment, heap cap and timeout. It is not network-isolated or containerized. Generated code runs only in the user's browser inside the CSP sandbox. For hostile multi-tenant use, run the worker in a container or microVM (README step 5) and serve previews from `PREVIEW_ORIGIN`.
5. **Generated projects are browser-only.** No server-side code and no arbitrary npm packages: only the allowlisted runtime (React, three, R3F/drei, gsap, motion, zustand, lucide-react, d3, selected three addons). Tailwind and other build-time tooling are not available to generated projects; the prompts instruct models to write plain CSS.
6. **Editor type information.** Monaco checks syntax and cross-file types but has no package typings (React, three), so diagnostics that only exist because of missing types are suppressed. Builds use esbuild, which does not type-check.
7. **Thumbnails** are generated category illustrations, not screenshots of previews.
8. **Canvas.** No rotation, no real-time multiplayer, no frame clipping of child content. AI frame layouts use text, rect and ellipse nodes only.
9. **3D Studio.** No imported GLB models inside scenes (GLB assets are viewable in Assets and Studio). Keyframe timelines are not implemented: animation is parametric (spin, orbit, float, pulse) driven by the timeline clock.
10. **Not built.** "100 agents" and real-time collaboration (out of scope by design). Agent concurrency is configurable (`AGENT_CONCURRENCY`, default 3).
11. A Windows quirk: stopping `next start` through a parent shell may leave the Node process running; stop it with `Stop-Process`.

---

## Where things are

| Area | Files |
| --- | --- |
| Pipeline | `src/server/pipeline/{generate,spec,review,prompts}.ts` |
| Orchestrator | `src/server/orchestrator/orchestrator.ts` |
| OpenAI provider / test provider | `src/server/ai/{openai-provider,mock-provider,provider,usage}.ts` |
| Build worker and runtime | `preview-runner/{build-worker.mjs,registry.mjs,shim.js}`, `src/server/build/*` |
| Preview/sites serving | `src/server/http/static.ts`, `src/app/{preview,preview-runtime,sites}/…/route.ts` |
| VFS rules and patching | `src/lib/vfs/{paths,apply}.ts` |
| Chat workspace UI | `src/components/workspace/*`, `src/components/editor/*`, `src/stores/workspace.ts` |
| 3D Studio | `src/components/scene/*`, `src/stores/scene-editor.ts`, `src/lib/schemas/scene.ts`, `src/lib/scene/templates.ts`, `src/server/scene-codegen/*` |
| Canvas | `src/components/canvas/*`, `src/stores/canvas-editor.ts`, `src/lib/schemas/canvas.ts` |
| Media | `src/server/media/providers.ts`, `src/server/services/media.ts`, `src/components/studio/*` |
| Publishing / share | `src/server/publish/publish.ts`, `src/server/services/share.ts` |
| Auth / API wrapper | `src/server/auth/*`, `src/server/http/{api,errors,rate-limit}.ts`, `src/server/env.ts` |
| Tests | `tests/unit/*`, `tests/e2e/acceptance.spec.ts`, `tests/integration/openai.live.test.ts` |

## Suggested next steps

1. Add an OpenAI key and run `npm run test:openai`; then try the four example prompts in Chat and tune `src/server/pipeline/prompts.ts` against real outputs.
2. Containerize the build worker and deploy previews on a separate domain.
3. Redis-backed job queue and rate limiting for multi-instance deployments.
4. GLB model objects in SceneSpec; keyframe animation tracks.
5. Preview screenshots for project thumbnails, captured inside the sandbox and posted via the shim.
