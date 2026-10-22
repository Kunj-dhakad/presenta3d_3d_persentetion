import type { Metadata } from "next";
import { AssetLibrary } from "@/components/assets/asset-library";

export const metadata: Metadata = { title: "Assets" };

export default function AssetsPage() {
  return <AssetLibrary />;
}
