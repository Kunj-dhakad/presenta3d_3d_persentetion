import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { authMode } from "@/server/env";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  // Local single-user mode has no sign-in.
  if (authMode() === "local") redirect("/chat");
  return (
    <Suspense>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
