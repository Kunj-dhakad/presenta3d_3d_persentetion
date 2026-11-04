import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { DeckSpec } from "@/lib/schemas/deck";

const RUNTIME_PATH = path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "server", "deck", "cine-runtime.js.txt");

/**
 * The cinematic engine's styles. Like the 3D engine, the presentation fills
 * the screen and has the same controls (chip, hint, dots bar, progress, notes,
 * branding: copied verbatim from codegen.ts). Each slide's background (image,
 * particles, grain) fills the screen; its text and visual are laid out on a
 * 1920×1080 frame (1080×1920 on portrait screens) scaled to fit (--k), so every
 * size of the slide's content is in frame pixels. Motion: enterCine / exitCine between
 * slides, Ken Burns on images, entrance effects on text (a-*), floating
 * particles, film grain and letterbox bars.
 */
const STYLE = `:root { --bg: #030608; --text: #f6f1ea; --accent: #ff7a1a; --tone: #ff7a1a; --title: "Bebas Neue", "Oswald", Impact, sans-serif; --body: "Barlow", "Inter", system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; background: #000; color: var(--text); font-family: var(--body); -webkit-font-smoothing: antialiased; }
body[data-font="sans"] { --title: "Oswald", "Bebas Neue", Impact, sans-serif; }
body[data-font="serif"] { --title: "Playfair Display", Georgia, serif; }
body[data-font="mono"] .kicker { font-family: "JetBrains Mono", ui-monospace, monospace; }
#stage { position: fixed; inset: 0; overflow: hidden; background: var(--bg); cursor: default; }
.slide { position: absolute; inset: 0; overflow: hidden; }
.frame { position: absolute; left: 50%; top: 50%; width: 1920px; height: 1080px; transform: translate(-50%, -50%) scale(var(--k, 1)); }
body.portrait .frame { width: 1080px; height: 1920px; }
.pill, .hud, #notes, #brand { font-family: "Inter", system-ui, sans-serif; }
.slide.enter { animation: enterCine 1.1s cubic-bezier(.2,.8,.2,1) both; }
.slide.exit { animation: exitCine .7s ease-in both; pointer-events: none; }
@keyframes enterCine { 0% { opacity: 0; filter: blur(30px) brightness(3); transform: scale(1.3); } to { opacity: 1; filter: none; transform: none; } }
@keyframes exitCine { 0% { opacity: 1; filter: none; transform: none; } to { opacity: 0; filter: blur(20px) brightness(.2); transform: scale(.85); } }

/* backgrounds */
.bg { position: absolute; inset: 0; background: radial-gradient(60% 70% at 78% 45%, color-mix(in srgb, var(--tone) 16%, transparent), transparent 70%), var(--bg); }
.bg::after { content: ""; position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px); background-size: 4px 4px; }
.bg img { position: absolute; inset: -4%; width: 108%; height: 108%; object-fit: cover; animation: kenburns 18s ease-out both; }
@keyframes kenburns { 0% { transform: scale(1.25) translate(2%, 1%); } to { transform: scale(1.02) translate(-2%, -1%); } }
.bg.has-img::before { content: ""; position: absolute; inset: 0; z-index: 1; background: linear-gradient(90deg, color-mix(in srgb, var(--bg) 80%, transparent) 0%, color-mix(in srgb, var(--bg) 32%, transparent) 40%, transparent 66%); }
.look-closing .bg.has-img::before { background: linear-gradient(180deg, color-mix(in srgb, var(--bg) 55%, transparent), transparent 35%, transparent 65%, color-mix(in srgb, var(--bg) 70%, transparent)), radial-gradient(70% 60% at 50% 50%, color-mix(in srgb, var(--bg) 45%, transparent), transparent 75%); }
.bg.painting img { display: none; }
.vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(130% 100% at 50% 50%, transparent 60%, rgba(0,0,0,.5)); }
.grain { position: absolute; inset: -10%; pointer-events: none; opacity: .09; mix-blend-mode: overlay; animation: grain .9s steps(4) infinite;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E"); }
@keyframes grain { 0%, to { transform: translate(0); } 25% { transform: translate(-2%, 1%); } 50% { transform: translate(1%, -2%); } 75% { transform: translate(2%, 2%); } }
.particles { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.particle { position: absolute; border-radius: 50%; background: var(--tone); box-shadow: 0 0 12px var(--tone), 0 0 24px color-mix(in srgb, var(--tone) 50%, transparent); opacity: 0; animation: floatUp linear infinite; }
@keyframes floatUp { 0% { opacity: 0; transform: translateY(0) translateX(0); } 10% { opacity: .9; } to { opacity: 0; transform: translateY(-1200px) translateX(120px); } }

/* text */
.content { position: absolute; z-index: 3; left: 140px; right: 140px; top: 50%; transform: translateY(-50%); }
.look-statement .content, .look-closing .content { text-align: center; }
.kicker { margin: 0 0 18px; font-size: 26px; font-weight: 500; letter-spacing: .55em; text-transform: uppercase; color: var(--accent); }
.title { margin: 0; font-family: var(--title); font-weight: 400; font-size: 150px; line-height: .93; letter-spacing: .005em; text-transform: uppercase; color: var(--text); text-wrap: balance; max-width: 1150px; text-shadow: 0 4px 40px rgba(0,0,0,.45); }
body[data-font="serif"] .title { text-transform: none; font-weight: 700; font-size: 120px; line-height: 1.02; }
.look-hero .title { font-size: 190px; text-shadow: 0 0 34px color-mix(in srgb, var(--accent) 55%, transparent), 0 4px 40px rgba(0,0,0,.5); }
.look-statement .title, .look-closing .title { font-size: 200px; margin: 0 auto; max-width: 1500px; }
.title .hl { color: var(--tone); text-shadow: 0 0 30px color-mix(in srgb, var(--tone) 70%, transparent), 0 0 70px color-mix(in srgb, var(--tone) 40%, transparent); }
.title .ch { display: inline-block; }
.subtitle { margin: 34px 0 0; font-size: 40px; line-height: 1.38; color: color-mix(in srgb, var(--text) 82%, transparent); max-width: 1120px; text-wrap: pretty; text-shadow: 0 2px 22px rgba(0,0,0,.6); }
.look-statement .subtitle, .look-closing .subtitle { margin-left: auto; margin-right: auto; }
.rule { height: 4px; width: 420px; margin: 56px auto 0; background: var(--accent); transform-origin: center; }
.stats { display: flex; gap: 110px; margin-top: 70px; }
.stat strong { display: block; font-family: var(--title); font-weight: 400; font-size: 170px; line-height: .9; color: var(--tone); text-shadow: 0 0 40px color-mix(in srgb, var(--tone) 55%, transparent); }
.stat span { display: block; margin-top: 18px; font-size: 34px; color: color-mix(in srgb, var(--text) 75%, transparent); max-width: 420px; }
.cards { display: grid; grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr)); gap: 30px; margin-top: 64px; }
.card { position: relative; padding: 44px 40px 48px 46px; border-radius: 18px; background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.025)); border: 1px solid rgba(255,255,255,.09); box-shadow: inset 34px 0 40px -34px rgba(255,255,255,.12); backdrop-filter: blur(10px); }
.card .num { font-family: var(--title); font-size: 110px; line-height: 1; color: var(--tone); }
.card h3 { margin: 22px 0 14px; font-family: var(--title); font-weight: 400; font-size: 58px; line-height: 1; text-transform: uppercase; }
.card p { margin: 0; font-size: 34px; line-height: 1.4; color: color-mix(in srgb, var(--text) 75%, transparent); }
.timeline { position: relative; display: grid; grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr)); margin-top: 90px; }
.timeline .line { position: absolute; left: 0; right: 0; top: 33px; height: 4px; background: var(--accent); transform-origin: left; }
.timeline .node { width: 70px; height: 70px; border-radius: 50%; position: relative; background: radial-gradient(circle at 35% 30%, #fff 0, color-mix(in srgb, var(--tone) 85%, #fff) 18%, var(--tone) 48%, color-mix(in srgb, var(--tone) 40%, #000) 100%); box-shadow: 0 0 40px var(--tone); }
.timeline h3 { margin: 46px 0 8px; font-family: var(--title); font-weight: 400; font-size: 110px; line-height: 1; }
.timeline p { margin: 0; font-size: 36px; color: color-mix(in srgb, var(--text) 78%, transparent); padding-right: 30px; }
.bullets { list-style: none; margin: 56px 0 0; padding: 0; display: grid; gap: 26px; }
.bullets li { position: relative; padding-left: 46px; font-size: 40px; line-height: 1.3; color: color-mix(in srgb, var(--text) 85%, transparent); }
.bullets li::before { content: ""; position: absolute; left: 0; top: .42em; width: 18px; height: 18px; border-radius: 50%; background: var(--tone); box-shadow: 0 0 16px var(--tone); }
.cta { display: flex; flex-wrap: wrap; gap: 22px; justify-content: center; margin-top: 64px; }
.cta a { padding: 22px 44px; border-radius: 999px; font-size: 32px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; text-decoration: none; color: var(--text); border: 2px solid rgba(255,255,255,.25); background: rgba(0,0,0,.35); }
.cta a.primary { background: var(--accent); border-color: var(--accent); color: #0a0a0a; }
.look-stats .content, .look-bullets .content { right: 820px; }
/* A statement with a visual reads left, the visual on the right (like the stats and bullets looks). */
.look-statement.has-visual .content { text-align: left; right: 820px; }
.look-statement.has-visual .title { font-size: 150px; margin: 0; }
.look-statement.has-visual .subtitle, .look-statement.has-visual .rule { margin-left: 0; }
body.portrait .look-statement.has-visual .content { right: 90px; top: 150px; bottom: auto; }

/* visuals (slides without an image) */
.visual { position: absolute; z-index: 2; right: 170px; top: 50%; width: 560px; height: 560px; margin-top: -280px; pointer-events: none; perspective: 1200px; }
.orb { position: absolute; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff 0, color-mix(in srgb, var(--tone) 70%, #fff) 14%, var(--tone) 45%, color-mix(in srgb, var(--tone) 35%, #000) 100%); box-shadow: 0 0 80px color-mix(in srgb, var(--tone) 70%, transparent), 0 0 160px color-mix(in srgb, var(--tone) 35%, transparent); }
.v-planet .orb, .v-pulse .orb, .v-orbs .orb.big { left: 50%; top: 50%; width: 300px; height: 300px; margin: -150px 0 0 -150px; animation: sphere 9s ease-in-out infinite; }
@keyframes sphere { 0%, to { transform: translateY(0); } 50% { transform: translateY(-30px); } }
.v-planet .ring { position: absolute; left: -10px; top: 50%; width: 580px; height: 580px; margin-top: -290px; border-radius: 50%; border: 4px solid var(--tone); box-shadow: 0 0 22px var(--tone), inset 0 0 22px color-mix(in srgb, var(--tone) 60%, transparent); animation: spin3d 14s linear infinite; }
.v-spiral .ring { position: absolute; left: 50%; width: 520px; height: 520px; margin-left: -260px; border-radius: 50%; border: 4px solid var(--tone); box-shadow: 0 0 26px var(--tone); animation: spin3d 9s linear infinite; }
.v-spiral .ring:nth-child(1) { top: -40px; } .v-spiral .ring:nth-child(2) { top: 40px; animation-duration: 11s; } .v-spiral .ring:nth-child(3) { top: 120px; animation-duration: 13s; } .v-spiral .ring:nth-child(4) { top: 200px; animation-duration: 15s; }
@keyframes spin3d { 0% { transform: rotateX(70deg) rotate(0); } to { transform: rotateX(70deg) rotate(360deg); } }
.v-orbs .orb.small { left: 50%; top: 50%; width: 64px; height: 64px; margin: -32px 0 0 -32px; animation: orbit linear infinite; }
.v-orbs .orb.small:nth-of-type(2) { --r: 250px; animation-duration: 9s; } .v-orbs .orb.small:nth-of-type(3) { --r: 300px; animation-duration: 13s; animation-direction: reverse; filter: hue-rotate(160deg); } .v-orbs .orb.small:nth-of-type(4) { --r: 210px; animation-duration: 17s; }
@keyframes orbit { 0% { transform: rotate(0) translateX(var(--r)) rotate(0); } to { transform: rotate(360deg) translateX(var(--r)) rotate(-360deg); } }
.v-pulse .wave { position: absolute; left: 50%; top: 50%; width: 300px; height: 300px; margin: -150px 0 0 -150px; border-radius: 50%; border: 3px solid var(--tone); opacity: 0; animation: wave 4.5s ease-out infinite; }
.v-pulse .wave:nth-of-type(2) { animation-delay: 1.5s; } .v-pulse .wave:nth-of-type(3) { animation-delay: 3s; }
@keyframes wave { 0% { opacity: .8; transform: scale(1); } to { opacity: 0; transform: scale(2.4); } }

/* entrance effects (delays set by the runtime) */
.a { animation-duration: 1.2s; animation-timing-function: cubic-bezier(.2,.8,.2,1); animation-fill-mode: both; }
.a-rise { animation-name: rise; } .a-zoom { animation-name: zoomIn; animation-duration: 1.5s; } .a-slide { animation-name: slideL; } .a-drop { animation-name: drop; }
.a-blur { animation-name: sharpen; } .a-flip { animation-name: flip3d; } .a-letter { animation-name: letter; animation-duration: .9s; } .a-line { animation-name: line; } .a-fade { animation-name: fade; }
@keyframes rise { 0% { opacity: 0; filter: blur(14px); transform: translateY(80px) scale(.96); } to { opacity: 1; filter: none; transform: none; } }
@keyframes zoomIn { 0% { opacity: 0; filter: blur(30px); letter-spacing: .4em; transform: scale(2.2); } to { opacity: 1; filter: none; transform: none; } }
@keyframes slideL { 0% { opacity: 0; filter: blur(10px); transform: translateX(-160px); } to { opacity: 1; filter: none; transform: none; } }
@keyframes drop { 0% { opacity: 0; filter: blur(10px); transform: translateY(-90px); } to { opacity: 1; filter: none; transform: none; } }
@keyframes sharpen { 0% { opacity: 0; filter: blur(40px); transform: scale(1.06); } to { opacity: 1; filter: none; transform: none; } }
@keyframes flip3d { 0% { opacity: 0; transform: perspective(1200px) rotateY(-80deg) translateZ(-300px); } to { opacity: 1; transform: perspective(1200px); } }
@keyframes letter { 0% { opacity: 0; filter: blur(8px); transform: translateY(.6em) rotateX(90deg); } to { opacity: 1; filter: none; transform: none; } }
@keyframes line { 0% { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes fade { 0% { opacity: 0; } to { opacity: 1; } }

/* letterbox bars and flash on every cut */
.bars::before, .bars::after { content: ""; position: absolute; left: 0; right: 0; height: 0; z-index: 20; background: #000; pointer-events: none; }
.bars::before { top: 0; } .bars::after { bottom: 0; }
.bars.cut::before, .bars.cut::after { animation: bar 1.1s cubic-bezier(.7,0,.2,1); }
@keyframes bar { 0% { height: 50%; } 55% { height: 8vh; } to { height: 0; } }
#flash { position: absolute; inset: 0; z-index: 21; background: #fff; opacity: 0; pointer-events: none; }
#flash.on { animation: flash .6s ease-out; }
@keyframes flash { 0% { opacity: .55; } to { opacity: 0; } }

/* portrait (phones): the stage is 1080×1920 */
body.portrait .content { left: 90px; right: 90px; top: 150px; transform: none; }
body.portrait .look-statement .content, body.portrait .look-closing .content, body.portrait .look-hero .content { top: auto; bottom: 260px; }
body.portrait .title { font-size: 150px; }
body.portrait .look-hero .title, body.portrait .look-statement .title, body.portrait .look-closing .title { font-size: 170px; }
body.portrait .look-stats .content, body.portrait .look-bullets .content { right: 90px; }
body.portrait .stats { flex-direction: column; gap: 50px; }
body.portrait .cards { grid-template-columns: 1fr; gap: 24px; margin-top: 50px; }
body.portrait .card { padding: 30px 34px; } body.portrait .card .num { font-size: 80px; } body.portrait .card h3 { margin: 10px 0 8px; }
body.portrait .timeline { grid-template-columns: 1fr; gap: 50px; } body.portrait .timeline .line { display: none; } body.portrait .timeline h3 { margin-top: 20px; }
body.portrait .visual { top: auto; bottom: 120px; right: 50%; margin: 0 -280px 0 0; transform: scale(.8); }
body.portrait .bg.has-img::before { background: linear-gradient(180deg, color-mix(in srgb, var(--bg) 80%, transparent), transparent 40%, transparent 55%, color-mix(in srgb, var(--bg) 90%, transparent)); }

/* controls: the same as the 3D engine (codegen.ts) */
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
.nav-btn { width: 32px; height: 32px; border-radius: 999px; border: 0; background: transparent; color: var(--text); cursor: pointer; font-size: 18px; display: inline-flex; align-items: center; justify-content: center; transition: background 0.2s; }
.nav-btn:hover { background: rgba(255, 255, 255, 0.1); }
.progress { position: fixed; top: 0; left: 0; right: 0; height: 2px; background: rgba(255, 255, 255, 0.05); }
#progress { height: 100%; background: var(--accent); transform-origin: left; transform: scaleX(0); transition: transform 0.9s cubic-bezier(.2,.8,.2,1); }
#notes { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); width: min(720px, calc(100% - 32px)); padding: 14px 18px; border-radius: 14px; background: rgba(8, 8, 12, 0.85); border: 1px solid rgba(255, 255, 255, 0.12); font-size: 14px; line-height: 1.5; display: none; }
body.show-notes #notes { display: block; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#play.playing { color: var(--accent); }
#brand { position: fixed; left: 18px; bottom: 20px; max-width: min(260px, 30vw); }
#brand .brand-link { display: inline-flex; align-items: center; gap: 10px; padding: 6px 12px 6px 6px; border-radius: 999px; background: rgba(12, 13, 20, 0.62); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); color: var(--text); font-size: 13px; text-decoration: none; max-width: 100%; }
#brand img { height: 28px; max-width: 110px; object-fit: contain; border-radius: 6px; }
#brand span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.9; }
@media (max-width: 760px) {
  #brand { left: auto; right: 12px; bottom: auto; top: 14px; max-width: 50vw; }
  #brand img { height: 22px; }
  #hint, #chip-title, #chip .sep { display: none; }
  .dot { width: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .slide.enter, .slide.exit, .a, .bg img, .particle, .grain, .orb, .ring, .wave, .bars.cut::before, .bars.cut::after { animation-duration: .01s !important; animation-iteration-count: 1 !important; }
}
`;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Deterministic cinematic DeckSpec → runnable presentation (no 3D, no imports).
 * It speaks the same protocol as the 3D engine (deck3d-preview slide events,
 * deck3d-deck commands, #<n> addresses), so the editor, the PHP viewer
 * (narration, avatar) and publishing work the same for both.
 */
export function cineToProjectFiles(deck: DeckSpec): { path: string; content: string }[] {
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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Bebas+Neue&family=Barlow:wght@400;500;600&family=Oswald:wght@500;600&family=Playfair+Display:wght@700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
  <style>
${STYLE}  </style>
</head>
<body>
  <div id="stage" class="bars" aria-live="polite"><div id="flash"></div></div>
  <div class="progress" aria-hidden="true"><div id="progress"></div></div>
  <div id="chip" class="pill"><span id="counter"></span><span class="sep"></span><span id="chip-title"></span></div>
  <div id="hint" class="pill">&#8592; &#8594; or scroll to travel</div>
  <div id="notes" role="note"></div>
  <footer id="brand" hidden></footer>
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
  ];
}
