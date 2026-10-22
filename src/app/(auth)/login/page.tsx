import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { authMode } from "@/server/env";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  // Local single-user mode has no sign-in.
  if (authMode() === "local") redirect("/chat");
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
