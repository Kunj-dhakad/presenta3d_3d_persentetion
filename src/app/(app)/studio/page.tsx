import type { Metadata } from "next";
import { StudioHome } from "@/components/studio/studio-home";

export const metadata: Metadata = { title: "Studio" };

export default function StudioPage() {
  return <StudioHome />;
}
