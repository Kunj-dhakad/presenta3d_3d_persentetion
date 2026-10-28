import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { createPresentation, newUser, openEmbedded, openedProjectId, preview } from "./support";

/**
 * Reliability of generation as users reported it: prompts sent while another
 * generation runs, the preview never showing an unstyled page, the 3D scenes
 * always arriving, and jobs that run in several short steps (as on serverless
 * hosts, which cut requests off after about a minute; playwright.config.ts
 * shortens the steps so every job here spans several requests).
 */

/** Every response for a generated 3D scene module, and every job step request. */
function watch(page: Page) {
  const scenes = new Set<string>();
  const steps: number[] = [];
  page.on("response", (r) => {
    const url = r.url();
    if (/\/scenes\/slide-\d+\.js$/.test(url) && r.ok()) scenes.add(url.replace(/^.*\/scenes\//, ""));
    if (/\/api\/jobs\/[^/]+\/run$/.test(url)) steps.push(r.status());
  });
  return { scenes, steps };
}

/** Whenever the preview iframe is visible, its document must already be styled. */
async function expectStyledWhenVisible(app: FrameLocator) {
  const frame = app.locator('iframe[title="Project preview"]');
  if (!(await frame.isVisible().catch(() => false))) return;
  const position = await preview(app)
    .locator("#hint")
    .evaluate((el) => getComputedStyle(el).position, undefined, { timeout: 1000 })
    .catch(() => "fixed"); // not loaded yet (and therefore hidden)
  expect(position).toBe("fixed");
}

const failure = /Interrupted|Generation failed|already running/;

test("a new presentation runs in several steps and arrives with all its custom 3D scenes", async ({ page, baseURL }) => {
  const seen = watch(page);
  const app = await openEmbedded(page, baseURL!, "/embed/new", newUser());
  await app.getByLabel("Describe your presentation").fill("Coral reef ecology for a museum audience");
  await app.getByRole("button", { name: "Create presentation" }).click();

  // Progress is shown in the chat while it works.
  await expect(app.getByText("Working on it")).toBeVisible();
  // Watch the preview while the job runs: it must never be shown unstyled.
  const ready = app.getByText(/Ready · \d+ slides/).first();
  for (let i = 0; i < 480 && !(await ready.isVisible()); i++) {
    await expectStyledWhenVisible(app);
    await page.waitForTimeout(250);
  }
  await expect(ready).toBeVisible();
  await expect(app.getByText(failure)).toHaveCount(0);

  // The job needed more than one step request, and each step answered normally.
  expect(seen.steps.length).toBeGreaterThan(1);
  expect(seen.steps.every((s) => s === 200)).toBe(true);

  // The 3D presentation: WebGL canvas, styled overlay, and a custom scene module for every slide.
  await expect(preview(app).locator("canvas#gl")).toBeVisible();
  await expectStyledWhenVisible(app);
  const counter = await preview(app).locator("#counter").textContent();
  const slides = Number(counter?.split("/")[1]);
  expect(slides).toBeGreaterThan(1);
  await expect.poll(() => seen.scenes.size, { timeout: 30_000 }).toBe(slides);
  // No runtime errors reported by the preview (WebGL, scene code).
  await expect(app.getByText(/runtime issue/)).toHaveCount(0);
});

test("a prompt sent while another generation runs shows that generation in the chat, not an error popup", async ({ page, context, baseURL }) => {
  const user = newUser();
  const app = await openEmbedded(page, baseURL!, "/embed/new", user);
  const projectId = await createPresentation(page, app, "Urban beekeeping basics");

  // A second tab on the same presentation, idle (it does not know about generations started elsewhere).
  const otherPage = await context.newPage();
  const other = await openEmbedded(otherPage, baseURL!, `/embed/p/${projectId}`, user);
  await expect(other.getByText(/Ready · \d+ slides/).first()).toBeVisible();

  // Tab 1 starts an edit; tab 2 sends its own prompt while that edit runs.
  await app.getByLabel("Message").fill("Make the titles shorter and punchier");
  await app.getByRole("button", { name: "Send" }).click();
  await expect(app.getByText("Working on it")).toBeVisible();
  await other.getByLabel("Message").fill("Use a warmer colour palette");
  await other.getByRole("button", { name: "Send" }).click();

  // Tab 2 follows the running generation in its chat; its prompt is kept for later.
  await expect(other.getByText("Working on it")).toBeVisible();
  await expect(other.getByLabel("Message")).toHaveValue("Use a warmer colour palette");
  await expect(other.getByText("A generation is already running for this project")).toHaveCount(0);

  // Both tabs see it finish; then tab 2's prompt goes through.
  await expect(app.getByText(/Updated “/).last()).toBeVisible({ timeout: 120_000 });
  await expect(other.getByText("Working on it")).toHaveCount(0, { timeout: 120_000 });
  await other.getByRole("button", { name: "Send" }).click();
  await expect(other.getByText("Use a warmer colour palette")).toBeVisible();
  await expect(other.getByText(/Updated “/).nth(1)).toBeVisible({ timeout: 120_000 });
  await expect(other.getByText(/Interrupted|Generation failed/)).toHaveCount(0);
});

test("a generation survives the page being reloaded in the middle, and finishes", async ({ page, baseURL }) => {
  const user = newUser();
  const app = await openEmbedded(page, baseURL!, "/embed/new", user);
  await app.getByLabel("Describe your presentation").fill("History of the bicycle");
  await app.getByRole("button", { name: "Create presentation" }).click();
  await expect(app.getByText("Working on it")).toBeVisible();
  const projectId = await openedProjectId(page);

  // The user leaves (the page that drove the steps is gone) and PHP opens the presentation again.
  const again = await openEmbedded(page, baseURL!, `/embed/p/${projectId}`, user);
  await expect(again.getByText(/Ready · \d+ slides/).first()).toBeVisible({ timeout: 120_000 });
  await expect(again.getByText(/Interrupted|Generation failed/)).toHaveCount(0);
  await expect(preview(again).locator("canvas#gl")).toBeVisible();
});
