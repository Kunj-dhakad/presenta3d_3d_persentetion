import { cn } from "@/lib/utils";

/**
 * Present 3D brand images (public/brand/): the P mark, and the full logo with
 * white text for this app's dark UI (present3d-logo.png has black text).
 */

/** The Present 3D "P" mark. Size it with a size-* class. */
export function LogoMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static brand image
    <img src="/brand/present3d-icon.png" alt="" aria-hidden="true" className={cn("size-6 object-contain", className)} />
  );
}

export function Logo({ className, withWordmark = true }: { className?: string; withWordmark?: boolean }) {
  if (!withWordmark) return <LogoMark className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static brand image
    <img src="/brand/present3d-logo-white.png" alt="Present 3D" className={cn("h-6 w-auto object-contain", className)} />
  );
}
