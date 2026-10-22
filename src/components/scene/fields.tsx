"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[84px_1fr] items-center gap-2", className)}>
      <span className="truncate text-[11.5px] text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-3 py-3">
      <h3 className="mb-2.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

/** Numeric input that only commits finite values (on change and blur). */
export function NumberInput({ value, onChange, step = 0.1, min, max, label }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; label: string }) {
  const [draft, setDraft] = useState(String(+value.toFixed(4)));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(String(+value.toFixed(4)));
  }
  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const v = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (v !== value) onChange(v);
  };
  return (
    <input
      type="number"
      aria-label={label}
      value={draft}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        setDraft(e.target.value);
        commit(e.target.value);
      }}
      onBlur={() => setDraft(String(+value.toFixed(4)))}
      className="h-7 w-full min-w-0 rounded-md border border-input bg-background/60 px-1.5 font-mono text-[11.5px] outline-none focus:border-ring"
    />
  );
}

export function Vec3Input({ value, onChange, step = 0.1, label }: { value: number[]; onChange: (v: number[]) => void; step?: number; label: string }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {["X", "Y", "Z"].map((axis, i) => (
        <div key={axis} className="relative">
          <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-semibold text-muted-foreground">{axis}</span>
          <div className="[&_input]:pl-4">
            <NumberInput label={`${label} ${axis}`} value={value[i]} step={step} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  return (
    <div className="flex items-center gap-1.5">
      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="size-7 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5" />
      <input
        aria-label={`${label} hex`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase());
        }}
        onBlur={() => setDraft(value)}
        className="h-7 w-full min-w-0 rounded-md border border-input bg-background/60 px-1.5 font-mono text-[11.5px] uppercase outline-none focus:border-ring"
      />
    </div>
  );
}

export function SliderInput({ value, onChange, min, max, step, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Slider aria-label={label} value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} className="flex-1" />
      <span className="w-10 text-right font-mono text-[11px] text-muted-foreground">{+value.toFixed(2)}</span>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <Switch aria-label={label} checked={checked} onCheckedChange={onChange} size="sm" />;
}

export function EnumSelect<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[] | { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const opts = (options as readonly (T | { value: T; label: string })[]).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {opts.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
