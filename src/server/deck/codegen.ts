import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { DeckSpec } from "@/lib/schemas/deck";
import { validateSceneCode } from "./scene-code";
import { cineToProjectFiles } from "./cine-codegen";

const RUNTIME_PATH = path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "server", "deck", "runtime.js.txt");

const STYLE = `:root { --bg: #05060a; --text: #f2f3f7; --accent: #8b9cff; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--bg); color: var(--text); }
body { font-family: "Inter", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
body[data-font="serif"] .title { font-family: "Playfair Display", Georgia, serif; letter-spacing: -0.01em; }
body[data-font="display"] .title { font-family: "Space Grotesk", "Inter", sans-serif; }
/* "mono" decks keep the clean display title (monospace titles read poorly); only the small kicker is monospace. */
body[data-font="mono"] .title { font-family: "Space Grotesk", "Inter", sans-serif; }
body[data-font="mono"] .kicker { font-family: "JetBrains Mono", ui-monospace, monospace; }
#stage { position: fixed; inset: 0; cursor: default; }
#gl { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
#slide { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.slide { position: absolute; inset: 0; display: flex; padding: clamp(24px, 6vw, 96px); pointer-events: none; }
.slide .content { max-width: min(46rem, 100%); pointer-events: auto; position: relative; isolation: isolate; }
/* A soft shade of the background behind centred text keeps it readable over bright 3D scenes. */
.layout-hero .content::before, .layout-center .content::before, .layout-stats .content::before { content: ""; position: absolute; inset: -14% -12%; z-index: -1; pointer-events: none; background: radial-gradient(closest-side, color-mix(in srgb, var(--bg) 62%, transparent), transparent); }
.layout-hero, .layout-center, .layout-stats { align-items: center; justify-content: center; text-align: center; }
.layout-hero .content, .layout-center .content { max-width: 60rem; }
.layout-left { align-items: center; justify-content: flex-start; }
.layout-left .content, .layout-right .content { max-width: min(36rem, 46vw); }
.layout-right { align-items: center; justify-content: flex-end; }
.layout-stats { align-items: flex-end; padding-bottom: clamp(72px, 12vh, 140px); }
.layout-stats .content { max-width: 64rem; }
.kicker { margin: 0 0 14px; font-size: calc(13px * var(--ts, 1)); letter-spacing: 0.22em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
.title { margin: 0; font-weight: 700; line-height: 1.02; letter-spacing: -0.035em; font-size: calc(clamp(36px, 5.2vw, 76px) * var(--ts, 1)); text-wrap: balance; text-shadow: 0 2px 30px rgba(0, 0, 0, 0.55); }
.title .word { display: inline-block; white-space: nowrap; }
.title .char { display: inline-block; }
.layout-hero .title { font-size: calc(clamp(44px, 8vw, 120px) * var(--ts, 1)); }
.subtitle { margin: 18px 0 0; font-size: calc(clamp(16px, 1.6vw, 22px) * var(--ts, 1)); line-height: 1.5; opacity: 0.78; text-wrap: pretty; text-shadow: 0 1px 18px rgba(0, 0, 0, 0.6); }
.layout-hero .subtitle, .layout-center .subtitle { margin-left: auto; margin-right: auto; max-width: 42rem; }
.bullets { margin: 28px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; }
.bullets li { position: relative; padding-left: 26px; font-size: calc(clamp(15px, 1.35vw, 19px) * var(--ts, 1)); line-height: 1.45; opacity: 0.92; text-shadow: 0 1px 14px rgba(0, 0, 0, 0.75), 0 0 2px rgba(0, 0, 0, 0.6); }
.bullets li::before { content: ""; position: absolute; left: 0; top: 0.62em; width: 12px; height: 2px; background: var(--accent); border-radius: 2px; }
.layout-center .bullets, .layout-hero .bullets { justify-items: center; }
/* All stats on one row (--n is their count); two per row on phones. */
.stats { margin-top: 32px; display: grid; grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr)); gap: 16px; }
.stat { padding: 20px; border-radius: 18px; background: color-mix(in srgb, var(--bg) 62%, transparent); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); text-align: left; }
.stat strong { display: block; font-size: calc(clamp(26px, 3vw, 46px) * var(--ts, 1)); line-height: 1.1; letter-spacing: -0.03em; color: var(--accent); }
.stat span { display: block; margin-top: 4px; font-size: calc(14px * var(--ts, 1)); opacity: 0.75; }
.pill { display: inline-flex; align-items: center; gap: 10px; padding: 8px 14px; border-radius: 999px; background: rgba(12, 13, 20, 0.62); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(14px); font-size: 13px; }
#chip { position: fixed; top: 18px; left: 18px; max-width: calc(100% - 36px); }
#counter { color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
#chip .sep { width: 1px; height: 14px; background: rgba(255, 255, 255, 0.2); }
#chip-title { opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 38vw; }
#hint { position: fixed; top: 18px; right: 18px; color: rgba(255, 255, 255, 0.55); transition: opacity 0.8s; }
#hint.hidden { opacity: 0; pointer-events: none; }
.hud { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); padding: 6px 8px; gap: 6px; }
#dots { display: flex; gap: 6px; padding: 0 6px; }
.dot { width: 26px; height: 3px; border-radius: 3px; border: 0; padding: 0; background: rgba(255, 255, 255, 0.18); cursor: pointer; transition: background 0.4s; }
.dot:hover { background: rgba(255, 255, 255, 0.4); }
.dot.active { background: var(--accent); }
/* Hover preview of a slide above its dot, like a video's seek bar. */
#peek { position: fixed; z-index: 30; width: 112px; padding: 3px; border-radius: 9px; background: rgba(12, 13, 20, 0.86); border: 1px solid rgba(255, 255, 255, 0.14); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 18px 40px -16px rgba(0, 0, 0, 0.8); pointer-events: none; opacity: 0; transform: translateY(6px); transition: opacity 0.18s, transform 0.18s; }
#peek.on { opacity: 1; transform: none; }
#peek .peek-img { position: relative; aspect-ratio: 16 / 9; border-radius: 6px; overflow: hidden; background: var(--bg); display: flex; flex-direction: column; justify-content: center; padding: 6px 7px; text-align: left; }
#peek .peek-img img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
#peek .peek-k { font-size: 5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); font-weight: 700; margin-bottom: 2px; }
#peek .peek-t { font-size: 8px; font-weight: 700; line-height: 1.2; color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
#peek .peek-cap { display: flex; align-items: center; gap: 4px; padding: 4px 3px 1px; font-size: 9px; color: var(--text); }
#peek .peek-n { color: var(--accent); font-weight: 700; font-variant-numeric: tabular-nums; }
#peek .peek-c { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.85; }
@media (hover: none) { #peek { display: none; } }
.nav-btn { width: 32px; height: 32px; border-radius: 999px; border: 0; background: transparent; color: var(--text); cursor: pointer; font-size: 18px; display: inline-flex; align-items: center; justify-content: center; transition: background 0.2s; }
.nav-btn:hover { background: rgba(255, 255, 255, 0.1); }
.progress { position: fixed; top: 0; left: 0; right: 0; height: 2px; background: rgba(255, 255, 255, 0.05); }
#progress { height: 100%; background: var(--accent); transform-origin: left; transform: scaleX(0); transition: transform 0.9s cubic-bezier(.2,.8,.2,1); }
#notes { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); width: min(720px, calc(100% - 32px)); padding: 14px 18px; border-radius: 14px; background: rgba(8, 8, 12, 0.85); border: 1px solid rgba(255, 255, 255, 0.12); font-size: 14px; line-height: 1.5; display: none; }
body.show-notes #notes { display: block; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#play.playing { color: var(--accent); }
.cta { margin-top: 32px; display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
.cta-btn { display: inline-flex; align-items: center; padding: 12px 22px; border-radius: 999px; font-size: 15px; font-weight: 600; text-decoration: none; color: var(--text); border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(12, 13, 20, 0.5); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); transition: transform 0.2s, background 0.2s; }
.cta-btn:hover { transform: translateY(-1px); background: rgba(255, 255, 255, 0.1); }
.cta-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); }
#brand { position: fixed; left: 18px; bottom: 20px; max-width: min(260px, 30vw); }
#brand .brand-link { display: inline-flex; align-items: center; gap: 10px; padding: 6px 12px 6px 6px; border-radius: 999px; background: rgba(12, 13, 20, 0.62); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); color: var(--text); font-size: 13px; text-decoration: none; max-width: 100%; }
#brand img { height: 28px; max-width: 110px; object-fit: contain; border-radius: 6px; }
#brand span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.9; }
@media (max-width: 760px) {
  #brand { left: auto; right: 12px; bottom: auto; top: 14px; max-width: 50vw; }
  #brand img { height: 22px; }
  /* Phones: the text in the middle of the screen (it sat at the bottom), clear of the chip above and
     the dots bar below; "safe" keeps the top in view when a slide has more text than fits. */
  .slide { align-items: center !important; align-items: safe center !important; justify-content: center !important; text-align: center; padding: 64px 20px 92px; }
  .layout-left .content, .layout-right .content { max-width: 100%; }
  /* Centred over the 3D scene: the soft shade behind the text on every layout. */
  .layout-left .content::before, .layout-right .content::before { content: ""; position: absolute; inset: -14% -12%; z-index: -1; pointer-events: none; background: radial-gradient(closest-side, color-mix(in srgb, var(--bg) 62%, transparent), transparent); }
  .title { font-size: calc(clamp(30px, 8.6vw, 44px) * var(--ts, 1)); }
  .layout-hero .title { font-size: calc(clamp(36px, 11vw, 56px) * var(--ts, 1)); }
  .subtitle { margin-top: 14px; }
  .bullets { justify-items: center; margin-top: 20px; gap: 10px; }
  #hint, #chip-title, #chip .sep { display: none; }
  .dot { width: 14px; }
  .stats { grid-template-columns: repeat(2, 1fr); margin-top: 22px; gap: 10px; }
  .stat { padding: 14px; }
}
`;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Deterministic DeckSpec → runnable 3D presentation project.
 * The styles are inlined: with a separate style.css the page could paint
 * unstyled while that extra request (an S3 round trip) was still loading.
 */
export function deckToProjectFiles(deck: DeckSpec): { path: string; content: string }[] {
  // Cinematic presentations have their own engine (images and titles, no 3D).
  if (deck.style === "cinematic") return cineToProjectFiles(deck);
  const runtime = fs.readFileSync(RUNTIME_PATH, "utf8");
  return [
    {
      path: "index.html",
      content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(deck.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&family=Playfair+Display:wght@600;700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
  <style>
${STYLE}  </style>
</head>
<body>
  <div id="stage">
    <canvas id="gl" aria-hidden="true"></canvas>
    <main id="slide" aria-live="polite"></main>
  </div>
  <div class="progress" aria-hidden="true"><div id="progress"></div></div>
  <div id="chip" class="pill"><span id="counter"></span><span class="sep"></span><span id="chip-title"></span></div>
  <div id="hint" class="pill">&#8592; &#8594; or scroll to travel</div>
  <div id="notes" role="note"></div>
  <footer id="brand" hidden></footer>
  <div id="peek" aria-hidden="true"><div class="peek-img"></div><div class="peek-cap"><span class="peek-n"></span><span class="peek-c"></span></div></div>
  <nav class="hud pill" aria-label="Slides">
    <button id="prev" class="nav-btn" aria-label="Previous slide">&#8249;</button>
    <div id="dots"></div>
    <button id="next" class="nav-btn" aria-label="Next slide">&#8250;</button>
    <button id="play" class="nav-btn" aria-label="Auto-play (P)" title="Auto-play (P)">&#9654;</button>
    <button id="fs" class="nav-btn" aria-label="Toggle fullscreen (F)" title="Fullscreen (F)">&#x26F6;</button>
  </nav>
  <script type="module" src="./main.js"></script>
</body>
</html>
`,
    },
    { path: "deck.json", content: JSON.stringify(deck, null, 2) },
    { path: "main.js", content: runtime },
    // Custom per-slide scenes written by the model, as ES modules the engine imports.
    // Code that fails the screen is not emitted; the engine then uses the slide's catalog scene.
    ...deck.slides.flatMap((s, i) =>
      s.scene.code && validateSceneCode(s.scene.code).ok
        ? [{ path: `scenes/slide-${i + 1}.js`, content: `// Generated scene for slide ${i + 1}. Runs only inside the sandboxed presentation.
export default function scene(ctx) {
${s.scene.code}
}
` }]
        : [],
    ),
  ];
}
