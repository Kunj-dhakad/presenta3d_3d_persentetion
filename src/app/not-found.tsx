import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <LogoMark className="size-8 text-muted-foreground" />
      <h1 className="text-lg font-medium">Not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">This page does not exist, or the link has expired or been revoked.</p>
      <Link href="/" className="text-sm text-brand hover:underline">Go home</Link>
    </div>
  );
}
