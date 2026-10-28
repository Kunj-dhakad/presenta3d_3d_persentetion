import { Suspense } from "react";
import type { Metadata } from "next";
import { NewChat } from "@/components/workspace/new-chat";

export const metadata: Metadata = { title: "New 3D presentation" };

/** Describe a topic; creating it opens the workspace. */
export default function EmbedNewPage() {
  return (
    <div className="h-dvh overflow-y-auto">
      <Suspense>
        <NewChat />
      </Suspense>
    </div>
  );
}
