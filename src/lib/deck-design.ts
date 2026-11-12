/**
 * Looks the owner picks in the Design panel: four ready-made 3D templates
 * (a world, a font and a palette) and colour palettes. Applying one changes
 * only the look of a deck, never its slides' content or 3D scene types.
 */
import type { DeckSpec } from "@/lib/schemas/deck";

export type DeckColors = { background: string; text: string; accent: string; primary: string; secondary: string };
export type DeckDesign = Partial<DeckColors> & { environment?: DeckSpec["theme"]["environment"]; font?: DeckSpec["theme"]["font"] };

export type DeckTemplate = { id: string; name: string; description: string; environment: DeckSpec["theme"]["environment"]; font: DeckSpec["theme"]["font"]; colors: DeckColors };

export const DECK_TEMPLATES: DeckTemplate[] = [
  {
    id: "neon-tech",
    name: "Neon Tech",
    description: "Neon grid under the stars: startups, software, products",
    environment: "grid",
    font: "display",
    colors: { background: "#05060f", text: "#eef1ff", accent: "#4cc9ff", primary: "#4cc9ff", secondary: "#b46bff" },
  },
  {
    id: "deep-space",
    name: "Deep Space",
    description: "Nebulae and stars: vision, science, big ideas",
    environment: "space",
    font: "sans",
    colors: { background: "#04030c", text: "#f1ecff", accent: "#a78bfa", primary: "#a78bfa", secondary: "#f472b6" },
  },
  {
    id: "aurora",
    name: "Aurora Elegance",
    description: "Aurora over a glossy floor: wellness, culture, luxury",
    environment: "aurora",
    font: "serif",
    colors: { background: "#031410", text: "#effaf5", accent: "#5eead4", primary: "#5eead4", secondary: "#fbbf24" },
  },
  {
    id: "studio",
    name: "Corporate Studio",
    description: "Soft spotlit stage: business, finance, education",
    environment: "studio",
    font: "sans",
    colors: { background: "#0b0d12", text: "#f5f6f8", accent: "#3b82f6", primary: "#60a5fa", secondary: "#94a3b8" },
  },
];

/** `swatch`: the five colours its card shows in the Settings drawer (as in the Figma design). */
export const DECK_PALETTES: { id: string; name: string; colors: DeckColors; swatch: string[] }[] = [
  { id: "sunset", name: "Sunset", colors: { background: "#120609", text: "#fff3ec", accent: "#ff8a5b", primary: "#ff8a5b", secondary: "#c2417a" }, swatch: ["#120609", "#ff8a5b", "#ffa884", "#c2417a", "#ffe6d8"] },
  { id: "emerald", name: "Emerald", colors: { background: "#03120b", text: "#effbf3", accent: "#34d399", primary: "#34d399", secondary: "#facc15" }, swatch: ["#120609", "#34d399", "#5ce4b2", "#facc15", "#d2f2dd"] },
  { id: "ice", name: "ICE - Blue", colors: { background: "#060b14", text: "#f3f8ff", accent: "#93c5fd", primary: "#bfdbfe", secondary: "#e2e8f0" }, swatch: ["#060b14", "#93c5fd", "#bfdbfe", "#e2e8f0", "#e0eaf9"] },
  { id: "magenta", name: "Magenta", colors: { background: "#0d0414", text: "#fdf0ff", accent: "#e879f9", primary: "#e879f9", secondary: "#8b5cf6" }, swatch: ["#0d0414", "#e879f9", "#f096fe", "#8b5cf6", "#f6e7f9"] },
  { id: "lime", name: "Lime & Teal", colors: { background: "#070c0b", text: "#f0fdf4", accent: "#a3e635", primary: "#a3e635", secondary: "#2dd4bf" }, swatch: ["#120609", "#79d334", "#e4e45c", "#15fab9", "#d9f2d2"] },
  { id: "crimson", name: "Crimson Red", colors: { background: "#0f0406", text: "#fff1f2", accent: "#f43f5e", primary: "#f43f5e", secondary: "#fda4af" }, swatch: ["#060b14", "#f43f5e", "#fda4af", "#f9c8d0", "#feebed"] },
  { id: "copper", name: "Copper", colors: { background: "#110b06", text: "#fbf3ea", accent: "#e0a46b", primary: "#e0a46b", secondary: "#c08457" }, swatch: ["#120609", "#e0a46b", "#e0a46b", "#c08457", "#f9e7d4"] },
  { id: "ocean", name: "Ocean", colors: { background: "#030b14", text: "#ecfeff", accent: "#22d3ee", primary: "#22d3ee", secondary: "#3b82f6" }, swatch: ["#120609", "#22d3ee", "#1cbdd5", "#3b82f6", "#d4f2f4"] },
];

/** The deck's current colours, as the Design panel shows them (scene colours are taken from slide 1). */
export function deckColors(deck: Pick<DeckSpec, "theme" | "slides" | "style">): DeckColors {
  // Cinematic decks are image-led: the accent is their only extra colour.
  if (deck.style === "cinematic") {
    return { background: deck.theme.background, text: deck.theme.text, accent: deck.theme.accent, primary: deck.theme.accent, secondary: deck.theme.accent };
  }
  const first = deck.slides[0]?.scene;
  return { background: deck.theme.background, text: deck.theme.text, accent: deck.theme.accent, primary: first?.primary ?? deck.theme.accent, secondary: first?.secondary ?? deck.theme.accent };
}

/**
 * Apply a look to a deck. Scene colours go to every slide, swapped on every
 * other slide so neighbouring slides still differ.
 */
export function applyDeckDesign(deck: DeckSpec, design: DeckDesign): DeckSpec {
  const { primary, secondary, ...rest } = design;
  const theme = { ...deck.theme };
  if (rest.background) theme.background = rest.background;
  if (rest.text) theme.text = rest.text;
  if (rest.accent) theme.accent = rest.accent;
  if (rest.environment) theme.environment = rest.environment;
  if (rest.font) theme.font = rest.font;
  const slides =
    primary || secondary
      ? deck.slides.map((s, i) => {
          const a = primary ?? s.scene.primary;
          const b = secondary ?? s.scene.secondary;
          return { ...s, scene: { ...s.scene, primary: i % 2 ? b : a, secondary: i % 2 ? a : b } };
        })
      : deck.slides;
  return { ...deck, theme, slides };
}
