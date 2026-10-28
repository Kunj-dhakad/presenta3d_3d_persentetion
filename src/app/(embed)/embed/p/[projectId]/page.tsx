"use client";
import { use } from "react";
import { PresentationWorkspace } from "@/components/workspace/presentation-workspace";

/** One presentation: chat on the left, the live 3D deck on the right. */
export default function EmbedWorkspacePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  return (
    <div className="h-dvh">
      <PresentationWorkspace projectId={projectId} />
    </div>
  );
}
