"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Bell, CircleHelp, LogOut, Settings, Loader2, CheckCircle2, XCircle, LayoutGrid, Ban } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NAV_ITEMS, HELP } from "./nav-items";
import { api, timeAgo } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type SessionUser = { id: string; email: string; name: string };
type JobRow = { id: string; kind: string; status: string; createdAt: string; projectId: string | null; error: string | null; input: { prompt?: string } };

const KIND_LABEL: Record<string, string> = {
  "project-generate": "Project generation",
  "project-edit": "Project edit",
  "project-repair": "Project repair",
  scene: "3D scene",
  canvas: "Canvas frames",
  image: "Image",
  video: "Video",
  audio: "Speech",
  sfx: "Sound effect",
  model3d: "3D model",
  material: "Material",
};

function Notifications() {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api<{ jobs: JobRow[] }>("/api/jobs?limit=12");
      setJobs(r.jobs);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    // Initial fetch, then poll for running-job count; faster while the panel is open.
    const first = setTimeout(load, 0);
    const t = setInterval(load, open ? 4000 : 15000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load, open]);
  const running = jobs?.filter((j) => j.status === "running" || j.status === "queued").length ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground" aria-label={`Notifications${running ? `, ${running} running` : ""}`}>
              <Bell className="size-4.5" />
              {running > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand ring-2 ring-sidebar" />}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">Activity</TooltipContent>
      </Tooltip>
      <PopoverContent side="right" align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2.5 text-sm font-medium">Activity</div>
        <div className="max-h-96 overflow-auto thin-scroll">
          {error && <p className="p-4 text-sm text-destructive">Could not load activity.</p>}
          {!error && jobs === null && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
          {jobs?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No generation jobs yet.</p>}
          {jobs?.map((j) => (
            <div key={j.id} className="flex gap-2.5 border-b px-3 py-2.5 last:border-0">
              <span className="mt-0.5">
                {j.status === "succeeded" ? <CheckCircle2 className="size-4 text-success" /> : j.status === "failed" ? <XCircle className="size-4 text-destructive" /> : j.status === "cancelled" ? <Ban className="size-4 text-muted-foreground" /> : <Loader2 className="size-4 animate-spin text-brand" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="font-medium">{KIND_LABEL[j.kind] ?? j.kind}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(j.createdAt)}</span>
                </div>
                {j.input?.prompt && <p className="truncate text-xs text-muted-foreground">{j.input.prompt}</p>}
                {j.status === "failed" && j.error && <p className="line-clamp-2 text-xs text-destructive">{j.error}</p>}
                {j.projectId && j.kind.startsWith("project") && (
                  <Link href={`/chat/${j.projectId}`} className="text-xs text-brand hover:underline" onClick={() => setOpen(false)}>
                    Open project
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function HelpButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const key = Object.keys(HELP).find((k) => pathname.startsWith(k)) ?? "/chat";
  const help = HELP[key];
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={() => setOpen(true)} className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground" aria-label="Help for this page">
            <CircleHelp className="size-4.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Help</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{help.title} tips</DialogTitle>
            <DialogDescription>How this workspace works.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2.5 text-sm text-muted-foreground">
            {help.tips.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-brand" />
                {t}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AppSwitcher() {
  const pathname = usePathname();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="group flex size-10 items-center justify-center rounded-xl transition hover:bg-accent" aria-label="Switch app">
          <LogoMark className="size-7 text-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-88 p-2">
        <div className="flex items-center gap-2 px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <LayoutGrid className="size-3.5" /> Strata workspaces
        </div>
        <div className="grid gap-0.5">
          {NAV_ITEMS.map((n) => (
            <Link key={n.href} href={n.href} className={cn("flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-accent", pathname.startsWith(n.href) && "bg-accent")}>
              <n.icon className="mt-0.5 size-4 shrink-0 text-brand" />
              <span>
                <span className="block text-sm font-medium">{n.label}</span>
                <span className="block text-xs text-muted-foreground">{n.description}</span>
              </span>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AccountMenu({ user, localMode }: { user: SessionUser; localMode: boolean }) {
  const router = useRouter();
  const initials = user.name.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase() || "U";
  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex size-9 items-center justify-center rounded-full bg-linear-to-br from-brand/80 to-brand/40 text-[12px] font-semibold text-brand-foreground ring-1 ring-border transition hover:ring-brand" aria-label="Account menu">
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="truncate text-sm font-medium">{user.name}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <Settings /> Settings
        </DropdownMenuItem>
        {localMode ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Local single-user mode (no sign-in). Set AUTH_MODE=accounts to require accounts.</p>
        ) : (
          <DropdownMenuItem onSelect={signOut} variant="destructive">
            <LogOut /> Sign out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ user, localMode, children }: { user: SessionUser; localMode: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background md:flex-row">
      <aside className="hidden w-15 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-3 md:flex" aria-label="Main navigation">
        <AppSwitcher />
        <nav className="mt-3 flex flex-col items-center gap-1">
          {NAV_ITEMS.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Tooltip key={n.href}>
                <TooltipTrigger asChild>
                  <Link
                    href={n.href}
                    aria-label={n.label}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex size-10 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-foreground",
                      active && "bg-accent text-foreground before:absolute before:-left-2.5 before:h-5 before:w-0.5 before:rounded-full before:bg-brand",
                    )}
                  >
                    <n.icon className="size-4.5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{n.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-1">
          <HelpButton />
          <Notifications />
          <div className="mt-1">
            <AccountMenu user={user} localMode={localMode} />
          </div>
        </div>
      </aside>
      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
      {/* Mobile navigation */}
      <nav className="flex shrink-0 items-center justify-around border-t border-sidebar-border bg-sidebar px-1 py-1.5 md:hidden" aria-label="Main navigation">
        {NAV_ITEMS.map((n) => {
          const active = pathname.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] text-muted-foreground", active && "text-foreground")}>
              <n.icon className="size-4.5" />
              {n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
