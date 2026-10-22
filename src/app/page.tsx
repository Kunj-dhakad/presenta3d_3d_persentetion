import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Boxes, Keyboard, MessageSquare, Palette, Play, Rocket } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { currentUser } from "@/server/auth/session";
import { LandingPrompt } from "@/components/landing/landing-prompt";
import { StrataHero } from "@/components/landing/strata-hero";

async function NavCta() {
  const user = await currentUser();
  return user ? (
    <Link href="/chat" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/85">
      Open workspace <ArrowRight className="size-3.5" />
    </Link>
  ) : (
    <div className="flex items-center gap-2">
      <Link href="/login" className="inline-flex h-8 items-center rounded-lg px-3 text-sm text-muted-foreground transition hover:text-foreground">
        Sign in
      </Link>
      <Link href="/signup" className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/85">
        Get started
      </Link>
    </div>
  );
}

async function Prompt() {
  const user = await currentUser();
  return <LandingPrompt signedIn={Boolean(user)} />;
}

const FEATURES = [
  { icon: MessageSquare, title: "Just describe it", body: "Topic, audience, tone, number of slides: write it like you would brief a designer. The AI writes the story." },
  { icon: Boxes, title: "A 3D scene on every slide", body: "Galaxies, globes, crystals, charts, waves: each slide gets an animated 3D scene that matches its message." },
  { icon: Palette, title: "Edit by chatting", body: "“Make slide 3 a stats slide”, “warmer colours”, “shorter titles”. Every change can be undone." },
  { icon: Play, title: "Present full screen", body: "Present straight from the browser with smooth transitions, speaker notes and fullscreen." },
  { icon: Keyboard, title: "Keyboard, click or swipe", body: "Arrow keys, clicks and touch gestures all work, on desktop and on phones." },
  { icon: Rocket, title: "Publish & share", body: "Publish with one click and share a link to your presentation." },
];

const STEPS = ["Describe", "AI writes slides", "3D scenes", "Edit in chat", "Present", "Publish"];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Suspense fallback={<div className="h-8 w-40" />}>
            <NavCta />
          </Suspense>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <StrataHero />
        <div className="relative mx-auto max-w-3xl px-4 pb-20 pt-24 text-center sm:px-6 sm:pt-32">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-brand" /> AI · 3D · Presentations
          </p>
          <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.035em] sm:text-6xl">Describe it. Present it in 3D.</h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
            Type your topic and get a cinematic presentation where every slide comes alive with animated 3D. Edit it by chatting, present it full screen, publish it with a link.
          </p>
          <div className="mt-10">
            <Suspense fallback={<div className="mx-auto h-36 max-w-2xl rounded-2xl border border-border bg-card" />}>
              <Prompt />
            </Suspense>
          </div>
        </div>
      </section>

      <section className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
            {STEPS.map((s, i) => (
              <span key={s} className="flex items-center gap-2">
                <span className="rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-xs text-foreground">{s}</span>
                {i < STEPS.length - 1 && <ArrowRight className="size-3.5" />}
              </span>
            ))}
          </div>
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-background p-6">
                <f.icon className="size-5 text-brand" />
                <h3 className="mt-4 font-medium">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6">
          <Logo className="text-muted-foreground" />
          <span>Presentations run in a sandboxed preview. Your API keys stay on the server.</span>
        </div>
      </footer>
    </div>
  );
}
