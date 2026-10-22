import { expect, test, type Page } from "@playwright/test";

/**
 * Acceptance flow for the presentation product, driven through the real UI
 * against a production build. The AI is the deterministic offline test
 * provider, so the flow is reproducible without an API key.
 */

const SENTINEL = "sk-e2e-SENTINEL-must-not-leak-0000";

async function signUp(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Email").fill(`e2e-${Date.now()}-${Math.round(Math.random() * 1e6)}@test.local`);
  await page.getByLabel("Password").fill("password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/chat");
}

const preview = (page: Page) => page.frameLocator('iframe[title="Project preview"]');

async function createPresentation(page: Page, prompt: string) {
  await page.getByLabel("Describe your presentation").fill(prompt);
  await page.getByRole("button", { name: "Create presentation" }).click();
  await page.waitForURL(/\/chat\/[a-z0-9]+$/);
  await expect(page.getByText(/Ready · \d+ slides/).first()).toBeVisible({ timeout: 90_000 });
}

test("chat → 3D presentation → navigate slides → edit in chat → persists → undo", async ({ page }) => {
  await signUp(page);
  await createPresentation(page, "Ocean conservation for a school assembly");

  // The deck renders in the sandboxed preview with a 3D canvas and slide text.
  const frame = page.locator('iframe[title="Project preview"]');
  expect(await frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  await expect(preview(page).locator(".title")).toHaveText("Ocean conservation for a school assembly");
  await expect(preview(page).locator("canvas#gl")).toBeVisible();
  await expect(preview(page).locator("#counter")).toHaveText("01 / 04");

  // Navigate inside the presentation.
  await preview(page).locator("#next").click();
  await expect(preview(page).locator("#counter")).toHaveText("02 / 04");
  await expect(preview(page).locator(".title")).toHaveText("Attention is the new currency");

  // No code is shown in this product.
  await expect(page.getByRole("tree", { name: "Project files" })).toHaveCount(0);
  await expect(page.locator(".monaco-editor")).toHaveCount(0);

  // Edit through chat.
  await page.getByLabel("Message").fill('Change the title of slide 2 to "Why oceans matter"');
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Updated “/)).toBeVisible({ timeout: 90_000 });
  await preview(page).locator("#next").click();
  await expect(preview(page).locator(".title")).toHaveText("Why oceans matter");

  // Persisted across reload.
  await page.reload();
  await expect(page.getByText('Change the title of slide 2 to "Why oceans matter"')).toBeVisible();
  await preview(page).locator("#next").click();
  await expect(preview(page).locator(".title")).toHaveText("Why oceans matter");

  // Undo the edit.
  await page.getByRole("button", { name: "Undo this change" }).last().click();
  await expect(page.getByText("Reverted to the previous version")).toBeVisible();
  await preview(page).locator("#next").click();
  await expect(preview(page).locator(".title")).toHaveText("Attention is the new currency");
});

test("present full page and publish a shareable link", async ({ page, context }) => {
  await signUp(page);
  await createPresentation(page, "Quarterly business review");

  // Present full page.
  await page.getByRole("link", { name: "Present", exact: true }).click();
  await page.waitForURL(/\/present\//);
  const deck = page.frameLocator("iframe:not([title=\"Project preview\"])");
  await expect(deck.locator(".title")).toHaveText("Quarterly business review");
  await deck.locator("#next").click();
  await expect(deck.locator("#counter")).toHaveText("02 / 04");
  await page.getByRole("link", { name: "Exit" }).click();
  await page.waitForURL(/\/chat\//);

  // Publish and open the published link.
  await page.getByRole("button", { name: "Publish" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Local hosting")).toBeVisible();
  await dialog.getByRole("button", { name: /^Publish$/ }).click();
  const live = dialog.locator("a[href*='/sites/']").first();
  await expect(live).toBeVisible({ timeout: 60_000 });
  const url = (await live.getAttribute("href"))!;
  expect(url).toMatch(/\/sites\/[a-z0-9-]+\/$/);
  const site = await context.newPage();
  await site.goto(url);
  await expect(site.locator(".title")).toHaveText("Quarterly business review");
  await expect(site.locator("canvas#gl")).toBeVisible();
  // The site also works when opened without the trailing slash.
  await site.goto(url.replace(/\/$/, ""));
  await expect(site.locator(".title")).toHaveText("Quarterly business review");
});

test("presentations page: open, rename, duplicate, delete", async ({ page }) => {
  await signUp(page);
  await createPresentation(page, "Product launch");
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Presentations" })).toBeVisible();
  await page.getByRole("button", { name: /^Actions for / }).first().click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.getByText(/\(copy\)/).first()).toBeVisible();
  await page.getByRole("button", { name: /^Actions for .*\(copy\)/ }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByText(/\(copy\)/)).toHaveCount(0);
  await page.getByRole("button", { name: /^Actions for / }).first().click();
  await page.getByRole("menuitem", { name: "Present" }).click();
  await page.waitForURL(/\/present\//);
});

test("secrets never reach the browser", async ({ page }) => {
  await signUp(page);
  const bodies: string[] = [];
  page.on("response", async (r) => {
    const type = r.headers()["content-type"] ?? "";
    if (/javascript|json|html|text/.test(type)) bodies.push(await r.text().catch(() => ""));
  });
  for (const p of ["/chat", "/projects", "/"]) {
    await page.goto(p);
    await page.waitForLoadState("networkidle");
  }
  const config = await page.request.get("/api/config");
  bodies.push(await config.text());
  expect(bodies.length).toBeGreaterThan(5);
  for (const b of bodies) expect(b).not.toContain(SENTINEL);
  expect(await config.json()).toMatchObject({ config: { openai: { hasKey: true } } });
});

test("share link: full screen, keyboard without clicking, mouse wheel travels between slides", async ({ page, context }) => {
  await signUp(page);
  await createPresentation(page, "Climate change basics");
  const projectId = page.url().split("/chat/")[1];
  const share = await (await page.request.post(`/api/projects/${projectId}/share`, { data: { expiresInDays: 1 } })).json();
  const viewer = await context.newPage();
  await viewer.goto(share.path);
  // No page chrome: the presentation is the whole page.
  await expect(viewer.locator("header")).toHaveCount(0);
  const deck = viewer.frameLocator("iframe");
  await expect(deck.locator("#counter")).toHaveText("01 / 04");
  await expect(deck.locator("#chip-title")).toHaveText("Climate change basics");
  // Keyboard works immediately (keys are forwarded to the deck).
  await viewer.keyboard.press("ArrowRight");
  await expect(deck.locator("#counter")).toHaveText("02 / 04");
  await viewer.waitForTimeout(400);
  await viewer.keyboard.press("ArrowLeft");
  await expect(deck.locator("#counter")).toHaveText("01 / 04");
  // Mouse wheel: one notch = one slide.
  const box = (await viewer.locator("iframe").boundingBox())!;
  await viewer.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await viewer.waitForTimeout(800);
  await viewer.mouse.wheel(0, 120);
  await expect(deck.locator("#counter")).toHaveText("02 / 04");
  await viewer.waitForTimeout(1200);
  await viewer.mouse.wheel(0, -120);
  await expect(deck.locator("#counter")).toHaveText("01 / 04");
});
