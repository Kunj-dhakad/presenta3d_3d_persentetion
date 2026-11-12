"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Small upper-case heading inside a Settings section (the design's "COLOR PALETTES"). */
export function SubHeading({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return <h4 className={cn("mb-[15px] text-xs leading-[1.26] font-medium text-black/60 uppercase", first ? "mt-0" : "mt-[15px]")}>{children}</h4>;
}

/** An on/off row: title and hint on the left, a switch on the right; `children` show while it is on. */
export function ToggleRow({ id, title, hint, checked, onChange, first, children }: { id: string; title: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; first?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cn("py-3", !first && "border-t border-black/10", first && "pt-0")}>
      <div className="flex items-start gap-3.5">
        <div className="min-w-0 flex-1">
          <Label htmlFor={id} className="text-xs leading-[1.26] font-medium text-black/80">{title}</Label>
          {hint ? <p className="mt-1 text-xs leading-[1.26] text-black/60">{hint}</p> : null}
        </div>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
      {checked && children ? <div className="mt-3 space-y-3">{children}</div> : null}
    </div>
  );
}

// The design's tile colours behind each section's (coloured) icon.
const TILE_TONES = {
  blue: "bg-[linear-gradient(180deg,rgb(0_166_238/0.1),rgb(1_201_251/0.1))]",
  rose: "bg-[#ffeded]",
  amber: "bg-[#fffbeb]",
  coral: "bg-[#fdf7df]",
  green: "bg-[#ecfdf5]",
  cyan: "bg-[#e6f6fe]",
  slate: "bg-[#eef3f7]",
};

/** The 35px icon tile at the start of a section header; white while the section is open. */
export function IconTile({ tone, children }: { tone: keyof typeof TILE_TONES; children: React.ReactNode }) {
  return <span className={cn("flex size-[35px] shrink-0 items-center justify-center rounded-[7px] group-data-[state=open]/acc:bg-white [&_svg]:size-[18px]", TILE_TONES[tone])}>{children}</span>;
}

/** "ON" / "OFF" pill on a section header; nothing while unknown. */
export function StatePill({ on, locked }: { on: boolean | undefined; locked?: boolean }) {
  const pill = "mr-1 rounded-[5px] border border-black/5 px-[7px] py-[3px] text-[8px] leading-[1.26] font-medium uppercase";
  // Not in the owner's plan.
  if (locked) return <span className={cn(pill, "bg-amber-50 text-amber-700")}>Locked</span>;
  if (on === undefined) return null;
  return <span className={cn(pill, on ? "bg-[#eefdf4] text-[#16a34a]/70" : "bg-[#f4f8fb] text-black/60")}>{on ? "On" : "Off"}</span>;
}

/** The design's gradient action button (Save, Apply Color). */
export const ACTION_BTN =
  "h-[38px] rounded-lg bg-[linear-gradient(180deg,#0081b9,#01c9fb)] px-4 font-cta text-sm font-semibold text-white shadow-[0_4px_60px_rgb(0_53_72/0.2)] hover:brightness-105";
