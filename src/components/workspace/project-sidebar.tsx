"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Search, MessagesSquare } from "lucide-react";
import { api, timeAgo } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Row = { id: string; name: string; updatedAt: string; category: string; isScene: boolean; lastBuildStatus: string | null };
type Conversation = { id: string; title: string; updatedAt: string; _count: { messages: number } };

export function ProjectSidebar({ activeId, conversations, activeConversationId, onSelectConversation }: { activeId: string | null; conversations?: Conversation[]; activeConversationId?: string | null; onSelectConversation?: (id: string) => void }) {
  const [projects, setProjects] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    api<{ projects: Row[] }>("/api/projects?kind=code").then((r) => setProjects(r.projects), () => setFailed(true));
  }, [activeId]);
  const list = projects?.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="p-2">
        <Link href="/chat" className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-[13px] font-medium transition hover:bg-accent">
          <Plus className="size-3.5" /> New chat
        </Link>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" className="h-7 pl-7 text-xs" aria-label="Search projects" />
        </div>
      </div>
      {conversations && conversations.length > 1 && (
        <div className="border-b border-border px-2 pb-2">
          <p className="px-1.5 pb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Conversations</p>
          {conversations.map((c) => (
            <button key={c.id} onClick={() => onSelectConversation?.(c.id)} className={cn("flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-accent", c.id === activeConversationId && "bg-accent text-foreground")}>
              <MessagesSquare className="size-3 shrink-0" />
              <span className="truncate">{c.title}</span>
            </button>
          ))}
        </div>
      )}
      <p className="px-3.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Projects</p>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2 thin-scroll">
        {failed && <p className="px-1.5 text-xs text-destructive">Could not load projects.</p>}
        {!projects && !failed && Array.from({ length: 6 }).map((_, i) => <div key={i} className="mb-1 h-9 animate-pulse rounded-md bg-accent/40" />)}
        {list?.length === 0 && <p className="px-1.5 text-xs text-muted-foreground">No projects.</p>}
        {list?.map((p) => (
          <Link key={p.id} href={`/chat/${p.id}`} className={cn("block rounded-md px-2 py-1.5 transition hover:bg-accent", p.id === activeId && "bg-accent")}>
            <span className="flex items-center gap-1.5">
              <span className={cn("size-1.5 shrink-0 rounded-full", p.lastBuildStatus === "succeeded" ? "bg-success" : p.lastBuildStatus === "failed" ? "bg-destructive" : "bg-muted-foreground/40")} />
              <span className="truncate text-[13px]">{p.name}</span>
            </span>
            <span className="block pl-3 text-[11px] text-muted-foreground">{timeAgo(p.updatedAt)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
