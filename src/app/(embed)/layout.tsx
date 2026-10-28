import { EmbedGate } from "@/components/embed/embed-gate";

/** Pages the PHP app opens in its iframe; they wait for its access token. */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <EmbedGate>{children}</EmbedGate>;
}
