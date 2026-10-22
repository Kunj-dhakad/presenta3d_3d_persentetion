import { Boxes, Gamepad2, Globe, LayoutDashboard, Layers3, Palette, PieChart, Presentation, Sparkles } from "lucide-react";

const ICON = { website: Globe, "react-app": Layers3, dashboard: LayoutDashboard, scene3d: Boxes, game: Gamepad2, "ui-design": Palette, "data-viz": PieChart, "creative-asset": Sparkles, presentation: Presentation } as const;
const HUE: Record<string, number> = { website: 250, "react-app": 205, dashboard: 165, scene3d: 285, game: 330, "ui-design": 30, "data-viz": 140, "creative-asset": 60, presentation: 0 };

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Generated category artwork used as the project thumbnail. Previews are not
 * screenshotted (they run in isolated sandboxes), so thumbnails are
 * deterministic illustrations derived from the category and project id.
 */
export function ProjectThumb({ category, name, seed }: { category: string; name: string; seed: string }) {
  const Icon = ICON[category as keyof typeof ICON] ?? Globe;
  const hue = HUE[category] ?? 250;
  const h = hash(seed);
  const layers = [0, 1, 2].map((i) => ({ y: 30 + i * 16 + ((h >> (i * 4)) % 8), o: 0.35 - i * 0.09 }));
  return (
    <div className="relative aspect-video overflow-hidden border-b border-border" style={{ background: `linear-gradient(135deg, oklch(0.22 0.04 ${hue}), oklch(0.15 0.01 ${hue + 30}))` }}>
      <svg viewBox="0 0 160 90" className="absolute inset-0 size-full" aria-hidden="true">
        {layers.map((l, i) => (
          <path key={i} d={`M-10 ${l.y + 20} L80 ${l.y} L170 ${l.y + 20} L80 ${l.y + 40} Z`} fill={`oklch(0.75 0.12 ${hue + i * 15})`} opacity={l.o} />
        ))}
      </svg>
      <div className="absolute left-3 top-3 flex size-8 items-center justify-center rounded-lg bg-black/30 text-white/90 backdrop-blur-sm">
        <Icon className="size-4" />
      </div>
      <span className="absolute bottom-2.5 left-3 right-3 truncate text-[13px] font-medium text-white/85">{name}</span>
    </div>
  );
}
