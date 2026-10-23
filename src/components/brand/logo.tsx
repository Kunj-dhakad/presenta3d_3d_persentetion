import { cn } from "@/lib/utils";

/** 3D Presentation mark: three offset layers forming a rising stack. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-6", className)} aria-hidden="true">
      <defs>
        <linearGradient id="deck3d-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.82 0.1 275)" />
          <stop offset="1" stopColor="oklch(0.62 0.15 285)" />
        </linearGradient>
      </defs>
      <path d="M6 22.5 L16 27 L26 22.5 L16 18 Z" fill="currentColor" opacity="0.28" />
      <path d="M6 16 L16 20.5 L26 16 L16 11.5 Z" fill="currentColor" opacity="0.55" />
      <path d="M6 9.5 L16 14 L26 9.5 L16 5 Z" fill="url(#deck3d-g)" />
    </svg>
  );
}

export function Logo({ className, withWordmark = true }: { className?: string; withWordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-foreground", className)}>
      <LogoMark />
      {withWordmark && <span className="text-[15px] font-semibold tracking-[-0.02em]">3D Presentation</span>}
    </span>
  );
}
