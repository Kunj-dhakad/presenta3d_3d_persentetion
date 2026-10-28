import { createCipheriv, randomBytes } from "node:crypto";
import { expect, type FrameLocator, type Page } from "@playwright/test";

/**
 * The app runs inside the PHP app's (CI_Core) iframe. These helpers play that
 * PHP page: it embeds the app, answers REACT_READY with INIT_DATA (the user's
 * access token) and records what the app tells it (LOADER_OFF, P3D_OPENED…).
 */

export const PHP_ORIGIN = "http://php.test";
/** Must match PHP_TOKEN_KEY in playwright.config.ts. */
export const PHP_TOKEN_KEY = "e2e-php-token-key";

/** A token as PHP's encrypt_user_token() makes it: base64(iv . base64(AES-256-CBC("user_id=…:business_id=…"))). */
export function phpToken(userId: number, businessId: number): string {
  const key = Buffer.alloc(32);
  Buffer.from(PHP_TOKEN_KEY).copy(key);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(`user_id=${userId}:business_id=${businessId}`, "utf8"), cipher.final()]).toString("base64");
  return Buffer.concat([iv, Buffer.from(encrypted, "latin1")]).toString("base64");
}

/** A fresh user for each test, so tests never see each other's presentations. */
export function newUser() {
  return { userId: 100_000 + Math.floor(Math.random() * 1_000_000), businessId: 7 };
}

export type User = ReturnType<typeof newUser>;

/**
 * Open `path` of the app inside a simulated PHP page. Returns the app's frame.
 * `page.reload()` reloads the PHP page, which opens the app at `path` again.
 */
export async function openEmbedded(page: Page, baseURL: string, path: string, user: User): Promise<FrameLocator> {
  const token = phpToken(user.userId, user.businessId);
  await page.route(`${PHP_ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="margin:0">
<iframe id="app" src="${baseURL}${path}" style="border:0;width:100vw;height:100vh" allow="fullscreen"></iframe>
<script>
  window.__messages = [];
  window.addEventListener("message", (e) => {
    const frame = document.getElementById("app").contentWindow;
    if (e.source !== frame) return;
    window.__messages.push(e.data);
    if (e.data && e.data.type === "REACT_READY") frame.postMessage({ type: "INIT_DATA", token: ${JSON.stringify(token)}, URL: "${PHP_ORIGIN}/" }, "*");
  });
</script></body></html>`,
    }),
  );
  await page.goto(`${PHP_ORIGIN}/presentation3d`);
  const app = page.frameLocator("#app");
  // The app tells PHP to hide its loader once it has the token.
  await expect.poll(() => messages(page).then((m) => m.some((x) => x.type === "LOADER_OFF"))).toBe(true);
  return app;
}

export function messages(page: Page): Promise<{ type: string; projectId?: string }[]> {
  return page.evaluate(() => (window as unknown as { __messages: { type: string; projectId?: string }[] }).__messages ?? []);
}

/** The id of the presentation the app last told PHP it opened. */
export async function openedProjectId(page: Page): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(async () => {
      id = (await messages(page)).filter((m) => m.type === "P3D_OPENED").at(-1)?.projectId;
      return id;
    })
    .toBeTruthy();
  return id!;
}

/** The 3D deck shown in the workspace's sandboxed preview. */
export const preview = (app: FrameLocator) => app.frameLocator('iframe[title="Project preview"]');

/** Describe a presentation on the create page and wait until it is ready. */
export async function createPresentation(page: Page, app: FrameLocator, prompt: string) {
  await app.getByLabel("Describe your presentation").fill(prompt);
  await app.getByRole("button", { name: "Create presentation" }).click();
  await expect(app.getByText(/Ready · \d+ slides/).first()).toBeVisible({ timeout: 120_000 });
  return openedProjectId(page);
}
