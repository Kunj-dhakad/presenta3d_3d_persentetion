import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/session";
import { authMode } from "@/server/env";
import { AppShell } from "@/components/shell/app-shell";
import { LogoMark } from "@/components/brand/logo";

async function AuthedShell({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <AppShell user={user} localMode={authMode() === "local"}>{children}</AppShell>;
}

function ShellFallback() {
  return (
    <div className="flex h-dvh items-center justify-center bg-background">
      <LogoMark className="size-8 animate-pulse text-muted-foreground" />
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <AuthedShell>{children}</AuthedShell>
    </Suspense>
  );
}
