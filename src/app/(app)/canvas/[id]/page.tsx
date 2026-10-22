import { Suspense } from "react";
import type { Metadata } from "next";
import { CanvasEditor } from "@/components/canvas/canvas-editor";

export const metadata: Metadata = { title: "Canvas" };

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CanvasEditor canvasId={id} />;
}

export default function CanvasDocPage({ params }: PageProps<"/canvas/[id]">) {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading canvas…</div>}>
      <Inner params={params} />
    </Suspense>
  );
}
