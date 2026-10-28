import { expect, test } from "@playwright/test";
import { createPresentation, newUser, openEmbedded, phpToken, preview } from "./support";

/**
 * Acceptance flow for the presentation product, driven through the real UI
 * against a production build, embedded in a simulated PHP page (see
 * support.ts). The AI is the deterministic offline test provider, so the flow
 * is reproducible without an API key.
 */

const SENTINEL = "sk-e2e-SENTINEL-must-not-leak-0000";

test("chat → 3D presentation → navigate slides → edit in chat → persists → undo", async ({ page, baseURL }) => {
  const user = newUser();
  let app = await openEmbedded(page, baseURL!, "/embed/new", user);
  const projectId = await createPresentation(page, app, "Ocean conservation for a school assembly");

  // The deck renders in the sandboxed preview with a 3D canvas and slide text.
  const frame = app.locator('iframe[title="Project preview"]');
  expect(await frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  await expect(preview(app).locator(".title")).toHaveText("Ocean conservation for a school assembly");
  await expect(preview(app).locator("canvas#gl")).toBeVisible();
  await expect(preview(app).locator("#counter")).toHaveText("01 / 04");

  // Navigate inside the presentation.
  await preview(app).locator("#next").click();
  await expect(preview(app).locator("#counter")).toHaveText("02 / 04");
  await expect(preview(app).locator(".title")).toHaveText("Attention is the new currency");

  // No code is shown in this product.
  await expect(app.locator(".monaco-editor")).toHaveCount(0);

  // Edit through chat.
  await app.getByLabel("Message").fill('Change the title of slide 2 to "Why oceans matter"');
  await app.getByRole("button", { name: "Send" }).click();
  await expect(app.getByText(/Updated “/)).toBeVisible({ timeout: 120_000 });
  await preview(app).locator("#next").click();
  await expect(preview(app).locator(".title")).toHaveText("Why oceans matter");

  // Persisted: PHP opens the presentation again later.
  app = await openEmbedded(page, baseURL!, `/embed/p/${projectId}`, user);
  await expect(app.getByText('Change the title of slide 2 to "Why oceans matter"')).toBeVisible();
  await preview(app).locator("#next").click();
  await expect(preview(app).locator(".title")).toHaveText("Why oceans matter");

  // Undo the edit.
  await app.getByRole("button", { name: "Undo this change" }).last().click();
  await expect(app.getByText("Reverted to the previous version")).toBeVisible();
  await preview(app).locator("#next").click();
  await expect(preview(app).locator(".title")).toHaveText("Attention is the new currency");
});

test("present full page and publish a shareable link", async ({ page, context, baseURL }) => {
  const app = await openEmbedded(page, baseURL!, "/embed/new", newUser());
  await createPresentation(page, app, "Quarterly business review");

  // Present full page.
  await app.getByRole("link", { name: "Present", exact: true }).click();
  const deck = app.frameLocator('iframe:not([title="Project preview"])');
  await expect(deck.locator(".title")).toHaveText("Quarterly business review");
  await deck.locator("#next").click();
  await expect(deck.locator("#counter")).toHaveText("02 / 04");
  await app.getByRole("link", { name: "Exit" }).click();
  await expect(app.getByRole("button", { name: "Publish" })).toBeVisible();

  // Publish and open the published link.
  await app.getByRole("button", { name: "Publish" }).click();
  const dialog = app.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Publish$/ }).click();
  const live = dialog.getByRole("link", { name: "Open site" });
  await expect(live).toBeVisible({ timeout: 60_000 });
  const href = (await live.getAttribute("href"))!;
  // On the PHP app the public link is its own page (3d-view/<slug>); the site itself is served here.
  const slug = href.match(/(?:3d-view|sites)\/([a-z0-9-]+)/)![1];
  const site = await context.newPage();
  await site.goto(`${baseURL}/sites/${slug}/`);
  await expect(site.locator(".title")).toHaveText("Quarterly business review");
  await expect(site.locator("canvas#gl")).toBeVisible();
  // The site also works when opened without the trailing slash.
  await site.goto(`${baseURL}/sites/${slug}`);
  await expect(site.locator(".title")).toHaveText("Quarterly business review");
});

test("the API refuses requests without a valid PHP token", async ({ request }) => {
  expect((await request.get("/api/projects")).status()).toBe(401);
  expect((await request.get("/api/projects", { headers: { "x-access-token": "not-a-token" } })).status()).toBe(401);
  const ok = await request.get("/api/projects", { headers: { "x-access-token": phpToken(42, 7) } });
  expect(ok.status()).toBe(200);
});

test("one user cannot open another user's presentation", async ({ page, baseURL, request }) => {
  const app = await openEmbedded(page, baseURL!, "/embed/new", newUser());
  const projectId = await createPresentation(page, app, "Private roadmap");
  const other = await request.get(`/api/projects/${projectId}`, { headers: { "x-access-token": phpToken(999_999_999, 7) } });
  expect(other.status()).toBe(404);
});

test("secrets never reach the browser", async ({ page, baseURL }) => {
  const bodies: string[] = [];
  page.on("response", async (r) => {
    const type = r.headers()["content-type"] ?? "";
    if (/javascript|json|html|text/.test(type)) bodies.push(await r.text().catch(() => ""));
  });
  const app = await openEmbedded(page, baseURL!, "/embed/new", newUser());
  await expect(app.getByLabel("Describe your presentation")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(bodies.length).toBeGreaterThan(5);
  for (const b of bodies) expect(b).not.toContain(SENTINEL);
});

test("share link: full screen, keyboard without clicking, mouse wheel travels between slides", async ({ page, context, baseURL }) => {
  const user = newUser();
  const app = await openEmbedded(page, baseURL!, "/embed/new", user);
  const projectId = await createPresentation(page, app, "Climate change basics");
  const share = await (
    await page.request.post(`${baseURL}/api/projects/${projectId}/share`, { data: { expiresInDays: 1 }, headers: { "x-access-token": phpToken(user.userId, user.businessId) } })
  ).json();
  const viewer = await context.newPage();
  await viewer.goto(`${baseURL}${share.path}`);
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
