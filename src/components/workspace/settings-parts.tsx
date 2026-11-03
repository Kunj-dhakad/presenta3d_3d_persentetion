"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Small upper-case heading inside a Settings section. */
export function SubHeading({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return <h4 className={cn("mb-2.5 text-[11.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase", first ? "mt-0" : "mt-5")}>{children}</h4>;
}

/** An on/off row: title and hint on the left, a switch on the right; `children` show while it is on. */
export function ToggleRow({ id, title, hint, checked, onChange, first, children }: { id: string; title: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; first?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cn("py-3", !first && "border-t border-border", first && "pt-0")}>
      <div className="flex items-center gap-3.5">
        <div className="min-w-0 flex-1">
          <Label htmlFor={id} className="text-sm font-semibold">{title}</Label>
          {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
      {checked && children ? <div className="mt-3 space-y-3">{children}</div> : null}
    </div>
  );
}

const TILE_TONES = {
  blue: "bg-brand-soft text-brand",
  rose: "bg-rose-50 text-rose-600",
  amber: "bg-amber-50 text-amber-600",
  coral: "bg-orange-50 text-orange-600",
  green: "bg-emerald-50 text-emerald-600",
  cyan: "bg-cyan-50 text-cyan-600",
  slate: "bg-muted text-foreground/70",
};

/** The coloured icon tile at the start of a section header. */
export function IconTile({ tone, children }: { tone: keyof typeof TILE_TONES; children: React.ReactNode }) {
  return <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-[11px] [&_svg]:size-[17px]", TILE_TONES[tone])}>{children}</span>;
}

/** "On" / "Off" pill on a section header; nothing while unknown. */
export function StatePill({ on }: { on: boolean | undefined }) {
  if (on === undefined) return null;
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-[11.5px] font-bold", on ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground")}>{on ? "On" : "Off"}</span>
  );
}
