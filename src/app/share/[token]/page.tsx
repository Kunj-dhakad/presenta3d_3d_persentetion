import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { resolveShareToken } from "@/server/services/share";
import { previewUrlFor } from "@/server/build/urls";
import { ShareViewer } from "@/components/share/share-viewer";
import { ensureDeckEngineCurrent } from "@/server/deck/upgrade";
import { db } from "@/server/db/client";

export const metadata: Metadata = { title: "Shared presentation", robots: { index: false, follow: false } };

async function Inner({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Link validity depends on the current time (expiry): always resolve at request time.
  await connection();
  const link = await resolveShareToken(token);
  if (!link) notFound();
  await ensureDeckEngineCurrent(link.projectId);
  const p = (await db.project.findUnique({ where: { id: link.projectId } }))!;
  return <ShareViewer name={p.name} previewUrl={p.lastWorkingBuildId ? previewUrlFor(p.lastWorkingBuildId) : null} />;
}

/** Public, read-only view of a project behind an unguessable, revocable share token. */
export default function SharePage({ params }: PageProps<"/share/[token]">) {
  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
      <Inner params={params} />
    </Suspense>
  );
}
