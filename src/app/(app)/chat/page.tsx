import { Suspense } from "react";
import type { Metadata } from "next";
import { NewChat } from "@/components/workspace/new-chat";

export const metadata: Metadata = { title: "New chat" };

export default function ChatPage() {
  return (
    <Suspense>
      <NewChat />
    </Suspense>
  );
}
