import { expect, test, type Page } from "@playwright/test";

/**
 * Reliability of generation as users reported it: prompts sent while another
 * generation runs, the preview never showing an unstyled page, the 3D scenes
 * always arriving, and jobs that run in several short steps (as on serverless
 * hosts, which cut requests off after about a minute; playwright.config.ts
 * shortens the steps so every job here spans several requests).
 */

async function signUp(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Email").fill(`e2e-${Date.now()}-${Math.round(Math.random() * 1e6)}@test.local`);
  await page.getByLabel("Password").fill("password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/chat");
}

const preview = (page: Page) => page.frameLocator('iframe[title="Project preview"]');

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
async function expectStyledWhenVisible(page: Page) {
  const frame = page.locator('iframe[title="Project preview"]');
  if (!(await frame.isVisible())) return;
  const position = await preview(page).locator("#hint").evaluate((el) => getComputedStyle(el).position).catch(() => "fixed");
  expect(position).toBe("fixed");
}

test("a new presentation runs in several steps and arrives with all its custom 3D scenes", async ({ page }) => {
  const seen = watch(page);
  await signUp(page);
  await page.getByLabel("Describe your presentation").fill("Coral reef ecology for a museum audience");
  await page.getByRole("button", { name: "Create presentation" }).click();
  await page.waitForURL(/\/chat\/[a-z0-9]+$/);

  // Progress is shown in the chat while it works.
  await expect(page.getByText("Working on it")).toBeVisible();
  // Poll the preview while the job runs: it must never be shown unstyled.
  const ready = page.getByText(/Ready · \d+ slides/).first();
  for (let i = 0; i < 300 && !(await ready.isVisible()); i++) {
    await expectStyledWhenVisible(page);
    await page.waitForTimeout(250);
  }
  await expect(ready).toBeVisible();
  await expect(page.getByText(/Interrupted|Generation failed|already running/)).toHaveCount(0);

  // The job needed more than one step request, and each step answered normally.
  expect(seen.steps.length).toBeGreaterThan(1);
  expect(seen.steps.every((s) => s === 200)).toBe(true);

  // The 3D presentation: WebGL canvas, styled overlay, and a custom scene module for every slide.
  await expect(preview(page).locator("canvas#gl")).toBeVisible();
  await expectStyledWhenVisible(page);
  const counter = await preview(page).locator("#counter").textContent();
  const slides = Number(counter?.split("/")[1]);
  expect(slides).toBeGreaterThan(1);
  await expect.poll(() => seen.scenes.size, { timeout: 30_000 }).toBe(slides);
  // No runtime errors reported by the preview (WebGL, scene code).
  await expect(page.getByText(/runtime issue/)).toHaveCount(0);
});

test("a prompt sent while another generation runs shows that generation in the chat, not an error popup", async ({ page, context }) => {
  await signUp(page);
  await page.getByLabel("Describe your presentation").fill("Urban beekeeping basics");
  await page.getByRole("button", { name: "Create presentation" }).click();
  await page.waitForURL(/\/chat\/[a-z0-9]+$/);
  await expect(page.getByText(/Ready · \d+ slides/).first()).toBeVisible({ timeout: 90_000 });
  const url = page.url();

  // A second tab on the same presentation, idle (it does not know about generations started elsewhere).
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByText(/Ready · \d+ slides/).first()).toBeVisible();

  // Tab 1 starts an edit; tab 2 sends its own prompt while that edit runs.
  await page.getByLabel("Message").fill("Make the titles shorter and punchier");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Working on it")).toBeVisible();
  await other.getByLabel("Message").fill("Use a warmer colour palette");
  await other.getByRole("button", { name: "Send" }).click();

  // Tab 2 follows the running generation in its chat; its prompt is kept for later.
  await expect(other.getByText("Working on it")).toBeVisible();
  await expect(other.getByLabel("Message")).toHaveValue("Use a warmer colour palette");
  await expect(other.getByText("A generation is already running for this project")).toHaveCount(0);

  // Both tabs see it finish; then tab 2's prompt goes through.
  await expect(page.getByText(/Updated “/).last()).toBeVisible({ timeout: 90_000 });
  await expect(other.getByText("Working on it")).toHaveCount(0, { timeout: 90_000 });
  await other.getByRole("button", { name: "Send" }).click();
  await expect(other.getByText("Use a warmer colour palette")).toBeVisible();
  await expect(other.getByText(/Updated “/).last()).toBeVisible({ timeout: 90_000 });
  await expect(other.getByText(/Interrupted|Generation failed/)).toHaveCount(0);
});

test("a generation survives a page reload in the middle and finishes", async ({ page }) => {
  await signUp(page);
  await page.getByLabel("Describe your presentation").fill("History of the bicycle");
  await page.getByRole("button", { name: "Create presentation" }).click();
  await page.waitForURL(/\/chat\/[a-z0-9]+$/);
  await expect(page.getByText("Working on it")).toBeVisible();
  // Leave and come back while it runs (the page that drove the steps is gone).
  await page.reload();
  await expect(page.getByText(/Ready · \d+ slides/).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Interrupted|Generation failed/)).toHaveCount(0);
  await expect(preview(page).locator("canvas#gl")).toBeVisible();
});
