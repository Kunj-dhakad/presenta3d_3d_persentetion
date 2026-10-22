import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { previewUrlFor } from "@/server/build/urls";
import { PresentView } from "@/components/present/present-view";
import { ensureDeckEngineCurrent } from "@/server/deck/upgrade";

export const metadata: Metadata = { title: "Present" };

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");
  const owned = await db.project.findFirst({ where: { id, ownerId: user.id }, select: { id: true } });
  if (!owned) notFound();
  await ensureDeckEngineCurrent(owned.id);
  const project = (await db.project.findUnique({ where: { id: owned.id } }))!;
  return <PresentView projectId={project.id} name={project.name} url={project.lastWorkingBuildId ? previewUrlFor(project.lastWorkingBuildId) : null} />;
}

/** Full-page presentation view (owner only). */
export default function PresentPage({ params }: PageProps<"/present/[id]">) {
  return (
    <Suspense fallback={<div className="h-dvh bg-black" />}>
      <Inner params={params} />
    </Suspense>
  );
}
