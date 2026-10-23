# 3D Presentation

> **Current product mode: 3D presentations.** The UI is intentionally reduced to one flow:
> **describe a topic in chat → get a cinematic 3D presentation → present it full page → publish a link.**
>
> * The AI writes a validated `DeckSpec` (slides, copy, theme, and one of 11 animated 3D scenes per slide). It does not write code.
>   A fixed, tested three.js + GSAP engine renders it (`src/server/deck/`), so every generated presentation runs.
> * Chat follow-ups edit the deck ("make slide 3 a stats slide", "warmer colours"); every change can be undone.
> * **Present** (`/present/<id>`) shows the deck full page: arrow keys/click/swipe, `F` fullscreen, `N` speaker notes.
>   **Publish** serves it at `/sites/<slug>/` (or Vercel when configured).
> * Hidden from navigation, but still in the codebase: the code editor workspace, Studio, Canvas, Assets and Settings.
>   Re-enable them in `src/components/shell/nav-items.ts`. The general code-generation pipeline
>   (`src/server/pipeline/generate.ts`) is kept but not wired to the UI.
>
> Open the dev server at `http://localhost:3000`. Opening it via a LAN IP is allowed through `allowedDevOrigins` in `next.config.ts`.
>
> The sections below describe the full platform.

3D Presentation is an AI creative platform. Describe an idea in plain language and it generates **runnable, editable projects**: websites, React/TypeScript apps, interactive three.js scenes, browser games and data visualizations. Every project has a live sandboxed preview, a Monaco code editor, version history, chat-driven edits, and publishing.

It also includes a **3D Studio** (visual scene editor with AI scene generation), a **Canvas** (infinite design board with parallel AI frame generation), a **creative asset studio** (image / video / speech / sound / 3D model / material generation through real provider adapters) and an **asset library**.

> 3D Presentation is an original implementation inspired by the publicly documented functionality of tools like . It contains no code from, and claims no access to, any other product.

---

## Quick start (local)

Requirements: **Node.js 22.12+ (tested on 24.18 LTS)** and npm 11.

```bash
npm install                 # also runs `prisma generate`
cp .env.example .env        # then edit .env (see below)
npm run db:deploy           # apply the MySQL schema to configured AWS RDS
npm run db:seed             # optional: example projects, scenes and a canvas
npm run dev                 # http://localhost:3000
```

npm 11 blocks dependency install scripts by default. This repo's `package.json` → `allowScripts` already approves the native build scripts used by the app and isolated unit-test fixture (`esbuild`, `better-sqlite3`, `prisma`, `@prisma/engines`). If an install reports pending scripts, review them with `npm approve-scripts --allow-scripts-pending`.

The application requires the RDS MySQL variables in `.env` for local development and deployment. Escape literal `$` characters as `\$` in `.env` values; Next.js expands `$NAME` references when it loads env files. SQLite is isolated to the Vitest test fixture; the application server has no SQLite or PostgreSQL fallback.

### No sign-in by default

3D Presentation runs in **local single-user mode** (`AUTH_MODE=local`, the default) in development and production: open the app and start building. There is no sign-up or login, and every visitor shares the same workspace. Set `AUTH_MODE=accounts` to enable email/password accounts and per-user workspaces.

### Connect OpenAI

Set these in `.env` (server-side only; never prefix them with `NEXT_PUBLIC_`):

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4            # any Responses-API model your key can use
# optional media generation
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_VIDEO_MODEL=sora-2
# optional cost estimation (USD per 1M tokens)
OPENAI_PRICE_INPUT_PER_1M=
OPENAI_PRICE_OUTPUT_PER_1M=
```

Restart the dev server after changing `.env`. **Settings** shows which integrations are configured (never the keys themselves) and per-request usage: tokens, latency, request IDs and estimated cost.

Without a key the app still works for everything except AI generation, and it says so in the UI instead of failing silently.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server (Turbopack) |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | Route type generation + `tsc --noEmit` |
| `npm run lint` | ESLint (Next.js + React Compiler rules) |
| `npm test` | Unit/integration tests (Vitest, offline, isolated temp DB per file) |
| `npm run test:e2e` | Playwright acceptance tests against the **production build** (`npm run build` first); requires a separate disposable RDS DB in `E2E_MYSQL_DATABASE` |
| `npm run test:openai` | Optional live tests against your real OpenAI key (skipped without one; costs a few cents) |
| `npm run check:schemas` | Verifies every AI response schema converts to a strict JSON schema |
| `npm run db:migrate` / `db:deploy` / `db:seed` | Prisma migrations and seed data |
| `npm run verify` | typecheck → lint → tests → build |

---

## How generation works

```
prompt ─▶ planner (structured ProjectSpec) ─▶ normalize (paths, entry files, allowed packages)
       ─▶ task graph (one agent task per file group; entry group depends on the rest)
       ─▶ agents write files in parallel (bounded concurrency, file locks)
       ─▶ deterministic merge + reviewer ─▶ validated write to the virtual filesystem
       ─▶ isolated build worker (esbuild) ─▶ on failure: targeted repair agent (≤ MAX_REPAIR_ATTEMPTS)
       ─▶ checkpoint (pre-change + post-change versions) ─▶ sandboxed preview
```

* **Structured outputs.** Every model call uses the OpenAI Responses API with a strict JSON schema (Zod). Results are validated again server-side before anything is applied. Code changes use a file-operation contract: `create | replace | patch | delete`, search/replace patches, explanation, dependencies and validation notes.
* **Edits are targeted.** Follow-up messages run an edit planner over the file tree and relevant sources, then apply exact search/replace patches. They do not regenerate the project.
* **Honest progress.** The UI renders real server events (stages, agent tasks, streamed character counts, file changes, build results, repairs) over an NDJSON stream. Jobs run server-side and survive the browser closing.
* **Recovery.** Truncated output triggers per-file regeneration; missing files are requested again; invalid hunks are skipped with a note; build failures go to the repair agent. The last working build and version are never lost: the preview keeps showing them, and every AI change can be reviewed as a diff, kept, partially reverted per file, or rejected.

### The preview sandbox

Generated code is untrusted. It is never executed in the app's server process or origin.

1. **Build isolation.** A separate Node process (`preview-runner/build-worker.mjs`) runs with a scrubbed environment (no API keys, database URL or session secret), a heap cap, a hard timeout and bounded output. It receives sources on stdin and only parses and bundles them; it never runs them.
2. **No `npm install`.** Bare imports resolve to an **allowlisted preview runtime**: react, react-dom, three (+ selected addons), @react-three/fiber, drei, gsap, motion/framer-motion, zustand, lucide-react and d3. These are bundled once from this app's own lockfile-pinned `node_modules`. Anything else is a build error that the repair agent fixes.
3. **Opaque origin.** Previews are served with `Content-Security-Policy: sandbox allow-scripts …` (no `allow-same-origin`), so even when opened in a new tab they have an opaque origin: no access to the app's cookies, storage or credentialed APIs. `connect-src 'self'` blocks exfiltration requests to other hosts. The iframe adds the same sandbox, and mutating API calls reject `Origin: null`.
4. **Diagnostics without trust.** A tiny injected shim posts runtime errors to the parent. The parent accepts messages only from its own iframe window, and the shim never receives commands.

---

## Architecture

```
src/
  app/                    Next.js App Router
    (app)/                authenticated workspace: chat, studio, canvas, projects, assets, settings
    api/                  Route Handlers (all wrapped by server/http/api.ts)
    preview/ preview-runtime/ sites/ vendor/monaco/   static servers (sandboxed / self-hosted)
    share/[token]         public read-only share page
  components/             UI (shadcn/ui + Radix, Tailwind v4, motion, Monaco, react-three-fiber)
  stores/                 Zustand stores: workspace, scene editor, canvas editor
  lib/                    shared, framework-free code: Zod schemas, VFS path rules + patch engine, templates
  server/                 server-only code
    ai/                   provider interface, OpenAI Responses provider, offline test provider, usage
    pipeline/             planner/generator/editor/repair prompts, spec normalization, reviewer, pipeline
    orchestrator/         DAG task runner (concurrency, file locks, cancellation, merge)
    build/                build worker process manager, preview runtime, builds
    jobs/                 server-side job runner + event persistence
    media/                media provider adapters (OpenAI images/TTS/video, Meshy, ElevenLabs)
    publish/              deployment providers (local, Vercel)
    storage/              object storage (local disk, S3-compatible with SigV4)
    services/             projects, versions, canvas, share links, media jobs
    auth/  http/  env.ts  sessions, API wrapper (CSRF, auth, rate limits, size limits), config
preview-runner/           isolated build worker, runtime allowlist, preview shim
prisma/                   RDS MySQL schema + migrations; isolated SQLite test fixture; seed
tests/unit  tests/e2e  tests/integration
```

Data model (Prisma): `User, Session, Project, ProjectFile, ProjectVersion, Build, Conversation, ChatMessage, GenerationJob, Asset, CanvasDocument, CanvasVersion, ShareLink, Deployment, UsageRecord, AuditLog`.

---

## Security model (summary)

* Secrets live only in server env vars, read by `server/env.ts` (`import "server-only"`). A test scans every `"use client"` file for server imports or secret env reads, and an e2e test checks that a sentinel key never appears in any response.
* All input is validated with Zod. Request bodies have hard size limits. Project paths go through `validateProjectPath`: no traversal, absolute paths, backslashes, reserved names or unknown file types.
* Accounts: scrypt password hashes, random 256-bit session tokens stored as HMACs, HttpOnly SameSite cookies, CSRF origin checks on every mutation, per-user rate limits (generation, builds, uploads, auth). Every resource is ownership-checked server-side and returns 404 for other users' resources.
* Uploads: MIME allowlist, magic-byte sniffing, 25 MB cap, server-generated storage keys. Media is served with `nosniff` and a CSP sandbox.
* Share links: random tokens, only SHA-256 hashes stored, optional expiry, instant revoke.
* Audit log for sign-in, project create/delete/archive/restore, publishing, sharing, uploads and job cancellation.

---

## Production deployment guide

### AWS Amplify Hosting

This repository includes `amplify.yml`. Add the production values under Amplify Console → **Hosting → Environment variables**; the build spec forwards the app's server-side settings into Next.js so the SSR runtime can read them. At minimum, configure `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, `APP_ORIGIN`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `STORAGE_DRIVER=s3`, `KD_AWS_S3_BUCKET_NAME`, and `KD_AWS_REGION`. Add the `KD_AWS_ACCESS_KEY_ID` and `KD_AWS_SECRET_ACCESS_KEY` values if using the current S3 credential setup. Redeploy after adding or changing variables. The app requires RDS MySQL and cannot fall back to SQLite or PostgreSQL.

AWS warns that secrets written into `.env.production` may be readable to people with access to deployment artifacts, and recommends IAM roles for AWS resource access. Restrict artifact access and plan to replace static S3 keys with an execution role where supported. Also check Amplify's current Next.js SSR support before deploying: AWS currently documents support for Next.js 12 through 15, while this project is on Next.js 16.

1. **Database: AWS RDS MySQL**
   ```bash
   npm run db:deploy                             # uses MYSQL_* when MYSQL_HOST is set
   npm run db:generate
   ```
   Set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD` for RDS MySQL. The runtime uses Prisma's MariaDB driver adapter and the MySQL schema/migrations under `prisma/mysql`. The application has no SQLite/PostgreSQL runtime adapter.
2. **Required env**: `NODE_ENV=production`, `APP_ORIGIN`, `MYSQL_HOST`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, `OPENAI_API_KEY`, and `OPENAI_MODEL`. `AUTH_MODE` defaults to `local`; set it to `accounts` only when sign-in is wanted. `SESSION_SECRET` (≥ 32 random chars) is needed for accounts. Leave `AI_PROVIDER` unset (`mock` is refused in production).
3. **Storage**: `STORAGE_DRIVER=s3` with `KD_AWS_S3_BUCKET_NAME`, `KD_AWS_REGION`, `KD_AWS_ACCESS_KEY_ID`, and `KD_AWS_SECRET_ACCESS_KEY` (legacy `S3_*` names are also supported). All S3 objects are grouped under the `3dpresentation/` key prefix. Media, build previews, shared runtimes, and published site artifacts are stored in the configured bucket; project records and source files remain in RDS. The bucket can stay private because the app serves artifacts through its routes.
4. **Previews on a separate origin (recommended)**: serve `/preview`, `/preview-runtime` and `/sites` from a dedicated domain (e.g. `*.deck3d-usercontent.com`) and set `PREVIEW_ORIGIN`. The CSP sandbox already gives previews an opaque origin; a separate registrable domain adds defence in depth.
5. **Build worker isolation**: the worker already runs as a separate, env-scrubbed, time-boxed process. For multi-tenant production, run it in a container or microVM with **no network**, a read-only root filesystem and CPU/memory limits (gVisor, Firecracker, or a Kubernetes Job), using the same stdin/stdout JSON contract as `runWorker`.
6. **Public publishing**: `PUBLISH_PROVIDER=vercel` + `VERCEL_TOKEN` (and `VERCEL_TEAM_ID` if needed). The default `local` provider serves sites from this server under `/sites/<slug>` and is labelled as non-public.
7. **Run**: `npm ci && npm run build && npm start` behind TLS. `outputFileTracingIncludes` in `next.config.ts` ships the worker, the scene runtime template and Monaco assets.
8. **Scaling**: jobs, rate limits and build/preview files are single-instance. For several instances, move jobs to a queue (e.g. BullMQ on Redis) behind `server/jobs/runner.ts`, swap the in-memory rate limiter for Redis, and put previews and sites on shared object storage or a CDN.

---

## Versions (verified, exact)

| | |
| --- | --- |
| Node.js | 24.18.0 LTS (engines `>=22.12`) · npm 11.16.0 |
| Next.js | **16.4.2** (latest stable at build time; App Router, Turbopack, Cache Components, Partial Prefetching) |
| React / React DOM | 19.3.0 |
| TypeScript | 5.9.3 (strict) |
| Tailwind CSS | 4.3.3 · shadcn/ui CLI 4.22.1 (Radix, "nova") · lucide-react 1.61.0 |
| Prisma | 7.10.1 (stable; 8.x was RC only) with Prisma MariaDB adapter; SQLite adapter is test-only |
| OpenAI SDK | 7.39.0 (Responses API, `zodTextFormat`) · Zod 4.6.7 |
| three / R3F / drei | 0.186.1 / 9.8.2 / 10.7.9 · gsap 3.15.0 · motion 14.5.0 |
| Monaco | monaco-editor 0.57.0 (self-hosted) · @monaco-editor/react 4.7.0 |
| esbuild | 0.28.2 |
| Zustand | 5.0.15 |
| Vitest / Playwright | 5.0.5 / 1.64.1 |

See `IMPLEMENTATION_STATUS.md` for the feature list, limitations and test results.
