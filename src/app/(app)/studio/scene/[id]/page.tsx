import { Suspense } from "react";
import type { Metadata } from "next";
import { SceneEditor } from "@/components/scene/scene-editor";

export const metadata: Metadata = { title: "3D scene" };

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SceneEditor sceneId={id} />;
}

export default function ScenePage({ params }: PageProps<"/studio/scene/[id]">) {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading scene…</div>}>
      <Inner params={params} />
    </Suspense>
  );
}
