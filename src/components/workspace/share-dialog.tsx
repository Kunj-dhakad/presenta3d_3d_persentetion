"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, Globe, Link2, Loader2, Lock, Rocket, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorMessage, timeAgo } from "@/lib/api-client";

type Deployment = { id: string; status: string; url: string | null; provider: string; isPublic: boolean; error: string | null; createdAt: string; updatedAt: string };
type PublishInfo = { provider: { id: string; isPublic: boolean; storage?: string; ok: boolean; reason: string | null }; deployments: Deployment[] };

/** Links for built-in hosting are stored as paths; show them on the domain the app is served from. */
const absolute = (url: string | null) => (url && url.startsWith("/") ? `${window.location.origin}${url}` : url);
type Link = { id: string; tokenPrefix: string; createdAt: string; expiresAt: string | null; revokedAt: string | null; active: boolean };

function copy(text: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success("Copied"), () => toast.error("Could not copy"));
}

export function ShareDialog({ projectId, open, onOpenChange, hasWorkingBuild }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void; hasWorkingBuild: boolean }) {
  const [info, setInfo] = useState<PublishInfo | null>(null);
  const [links, setLinks] = useState<Link[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expiry, setExpiry] = useState("30");
  const [fresh, setFresh] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([api<PublishInfo>(`/api/projects/${projectId}/publish`), api<{ links: Link[] }>(`/api/projects/${projectId}/share`)]);
      setInfo(p);
      setLinks(l.links);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [projectId]);
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setFresh(null);
  }
  useEffect(() => {
    if (!open) return;
    let live = true;
    Promise.all([api<PublishInfo>(`/api/projects/${projectId}/publish`), api<{ links: Link[] }>(`/api/projects/${projectId}/share`)]).then(
      ([p, l]) => {
        if (!live) return;
        setInfo(p);
        setLinks(l.links);
      },
      (e) => live && toast.error(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [open, projectId]);

  const live = info?.deployments.find((d) => d.status === "ready");
  const latest = info?.deployments[0];

  async function publish() {
    setBusy("publish");
    try {
      const r = await api<{ deployment: Deployment }>(`/api/projects/${projectId}/publish`, { method: "POST" });
      if (r.deployment.status === "ready") toast.success(r.deployment.isPublic ? "Published" : "Published locally");
      else toast.error(r.deployment.error ?? "Deployment failed");
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function unpublish() {
    setBusy("unpublish");
    try {
      await api(`/api/projects/${projectId}/publish`, { method: "DELETE" });
      toast.success("Unpublished");
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function createLink() {
    setBusy("link");
    try {
      const r = await api<{ path: string }>(`/api/projects/${projectId}/share`, { method: "POST", json: { expiresInDays: expiry === "never" ? null : Number(expiry) } });
      setFresh(`${window.location.origin}${r.path}`);
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function revoke(id: string) {
    setBusy(id);
    try {
      await api(`/api/projects/${projectId}/share/${id}`, { method: "DELETE" });
      toast.success("Link revoked");
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] w-[calc(100vw-2rem)] max-w-2xl max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share & publish</DialogTitle>
          <DialogDescription>Publish your presentation as a web page, or create private share links.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="publish" className="min-h-0 min-w-0">
          <TabsList className="w-full">
            <TabsTrigger value="publish"><Rocket /> Publish</TabsTrigger>
            <TabsTrigger value="links"><Link2 /> Share links</TabsTrigger>
          </TabsList>
          <TabsContent value="publish" className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)] max-h-[calc(100dvh-13rem)] gap-3 overflow-y-auto pr-1">
            {!info ? (
              <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading…</p>
            ) : (
              <>
                <div className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    {info.provider.id === "local" || info.provider.isPublic ? <Globe className="size-4 text-success" /> : <Lock className="size-4 text-warning" />}
                    {info.provider.id === "local" ? (info.provider.storage === "s3" ? "Hosted by this app · stored in Amazon S3" : "Hosted by this app") : "Vercel"}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {info.provider.id === "local"
                      ? `Anyone with the link can view the presentation. It is served from this app's domain${info.provider.storage === "s3" ? " and its files are stored in your S3 bucket" : ""}.`
                      : "Deployments go to a public URL on the configured hosting provider."}
                  </p>
                  {!info.provider.ok && <p className="mt-2 text-xs text-destructive">{info.provider.reason}</p>}
                </div>
                {live && (
                  <div className="min-w-0 rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
                    <p className="text-xs text-muted-foreground">Live · updated {timeAgo(live.updatedAt)}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <a href={absolute(live.url) ?? "#"} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs text-brand hover:underline">{absolute(live.url)}</a>
                      <Button size="icon-xs" variant="ghost" className="shrink-0" onClick={() => live.url && copy(absolute(live.url)!)} aria-label="Copy URL"><Copy /></Button>
                      <a href={absolute(live.url) ?? "#"} target="_blank" rel="noopener noreferrer" aria-label="Open site" className="shrink-0"><ExternalLink className="size-3.5 text-muted-foreground" /></a>
                    </div>
                  </div>
                )}
                {latest?.status === "failed" && (
                  <p className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"><TriangleAlert className="size-4 shrink-0" />Last deployment failed: {latest.error}</p>
                )}
                {!hasWorkingBuild && <p className="text-xs text-muted-foreground">There is no successful build yet. Build the project before publishing.</p>}
                <div className="flex flex-wrap justify-end gap-2">
                  {live && <Button variant="ghost" onClick={() => void unpublish()} disabled={busy !== null}>{busy === "unpublish" && <Loader2 className="animate-spin" />}Unpublish</Button>}
                  <Button onClick={() => void publish()} disabled={busy !== null || !hasWorkingBuild || !info.provider.ok}>
                    {busy === "publish" ? <Loader2 className="animate-spin" /> : <Rocket />} {live ? "Publish update" : "Publish"}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
          <TabsContent value="links" className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)] max-h-[calc(100dvh-13rem)] gap-3 overflow-y-auto pr-1">
            <p className="text-xs text-muted-foreground">Anyone with a link can view the presentation (read-only). Links can expire and can be revoked at any time.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger className="w-full sm:w-40" aria-label="Link expiry"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Expires in 1 day</SelectItem>
                  <SelectItem value="7">Expires in 7 days</SelectItem>
                  <SelectItem value="30">Expires in 30 days</SelectItem>
                  <SelectItem value="never">Never expires</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => void createLink()} disabled={busy !== null} className="flex-1">{busy === "link" ? <Loader2 className="animate-spin" /> : <Link2 />} Create link</Button>
            </div>
            {fresh && (
              <div className="rounded-lg border border-brand/30 bg-brand/5 p-3">
                <p className="text-xs text-muted-foreground">Copy this link now. For security it is not shown again.</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-xs">{fresh}</code>
                  <Button size="xs" onClick={() => copy(fresh)}><Copy /> Copy</Button>
                </div>
              </div>
            )}
            <div className="min-w-0 rounded-lg border border-border">
              {links === null && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
              {links?.length === 0 && <p className="p-3 text-sm text-muted-foreground">No share links yet.</p>}
              {links?.map((l) => (
                <div key={l.id} className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2 text-xs last:border-0">
                  <code className="shrink-0 text-muted-foreground">{l.tokenPrefix}…</code>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    created {timeAgo(l.createdAt)} · {l.revokedAt ? "revoked" : l.active ? (l.expiresAt ? `expires ${new Date(l.expiresAt).toLocaleDateString()}` : "no expiry") : "expired"}
                  </span>
                  {l.active && (
                    <Button size="xs" variant="ghost" onClick={() => void revoke(l.id)} disabled={busy !== null}>
                      {busy === l.id ? <Loader2 className="animate-spin" /> : <Trash2 />} Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
