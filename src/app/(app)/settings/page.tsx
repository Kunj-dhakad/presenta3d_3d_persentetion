import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/session";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings" };

async function Inner() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <SettingsView user={{ name: user.name, email: user.email }} />;
}

export default function SettingsPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
