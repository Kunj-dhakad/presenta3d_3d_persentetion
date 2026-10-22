import { Suspense } from "react";
import type { Metadata } from "next";
import { PresentationWorkspace } from "@/components/workspace/presentation-workspace";
import { WorkspaceSkeleton } from "@/components/workspace/workspace-skeleton";

export const metadata: Metadata = { title: "Presentation" };

async function Inner({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <PresentationWorkspace projectId={projectId} />;
}

export default function ChatProjectPage({ params }: PageProps<"/chat/[projectId]">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <Inner params={params} />
    </Suspense>
  );
}
