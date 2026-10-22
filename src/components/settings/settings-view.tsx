"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleSlash, KeyRound, Loader2 } from "lucide-react";
import { api, errorMessage, timeAgo } from "@/lib/api-client";
import type { PublicConfigStatus } from "@/server/env";
import type { MediaKind, MediaProviderInfo } from "@/lib/media";
import { MEDIA_LABELS } from "@/lib/media";
import { cn } from "@/lib/utils";

type Usage = {
  totals: { requests: number; failures: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; costKnown: boolean; avgLatencyMs: number };
  records: { id: string; createdAt: string; provider: string; model: string; operation: string; requestId: string | null; inputTokens: number | null; outputTokens: number | null; latencyMs: number; estimatedCostUsd: number | null; success: boolean; errorCode: string | null }[];
};

function Status({ ok, label, hint }: { ok: boolean; label: string; hint?: string | null }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-border px-4 py-3 last:border-0">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 text-success" /> : <CircleSlash className="mt-0.5 size-4 text-muted-foreground" />}
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export function SettingsView({ user }: { user: { name: string; email: string } }) {
  const [config, setConfig] = useState<{ config: PublicConfigStatus; media: Record<MediaKind, (MediaProviderInfo & { availableForKind: boolean })[]> } | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([api<NonNullable<typeof config>>("/api/config"), api<Usage>("/api/usage")]).then(
      ([c, u]) => {
        setConfig(c);
        setUsage(u);
      },
      (e) => setError(errorMessage(e)),
    );
  }, []);
  const c = config?.config;
  return (
    <div className="h-full overflow-y-auto thin-scroll">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <section className="mt-8">
          <h2 className="text-sm font-medium">Account</h2>
          <div className="mt-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
            <p>{user.name}</p>
            <p className="text-muted-foreground">{user.email}</p>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4" /> AI & integrations</h2>
          <p className="mt-1 text-xs text-muted-foreground">Keys are server environment variables. They are never sent to the browser, so this page only shows whether each integration is configured.</p>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          {!c && !error && <p className="mt-3 flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading…</p>}
          {c && (
            <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
              {c.aiProvider === "mock" && <Status ok label="Test provider active (AI_PROVIDER=mock)" hint="Responses come from a deterministic offline fixture, not a model. Never use this setting in production." />}
              <Status ok={c.openai.configured} label={`OpenAI text generation${c.openai.model ? ` · ${c.openai.model}` : ""}`} hint={c.openai.configured ? "Responses API with structured outputs." : !c.openai.hasKey ? "Set OPENAI_API_KEY and OPENAI_MODEL." : "Set OPENAI_MODEL."} />
              {config &&
                (Object.keys(config.media) as MediaKind[]).map((k) => {
                  const best = config.media[k].find((p) => p.availableForKind) ?? config.media[k][0];
                  return <Status key={k} ok={Boolean(best?.availableForKind)} label={`${MEDIA_LABELS[k]} generation${best ? ` · ${best.label}` : ""}`} hint={best?.availableForKind ? best.model : best?.reason} />;
                })}
              <Status ok={c.openai.pricingConfigured} label="Cost estimation" hint={c.openai.pricingConfigured ? "Estimated from OPENAI_PRICE_INPUT_PER_1M / OPENAI_PRICE_OUTPUT_PER_1M." : "Set OPENAI_PRICE_INPUT_PER_1M and OPENAI_PRICE_OUTPUT_PER_1M to estimate costs."} />
              <Status ok={c.publish.publicHosting} label={`Publishing · ${c.publish.provider}`} hint={c.publish.publicHosting ? "Deployments are public on Vercel." : "Local hosting under /sites. Not a public deployment. Configure PUBLISH_PROVIDER=vercel and VERCEL_TOKEN for public hosting."} />
              <Status ok label={`Storage · ${c.storage}`} hint={c.storage === "local" ? "Files are stored under the server's data directory. Use STORAGE_DRIVER=s3 in production." : "S3-compatible object storage."} />
              <Status ok={Boolean(c.previewOrigin)} label="Separate preview origin" hint={c.previewOrigin ?? "Previews are served from this server with a CSP sandbox (opaque origin). Set PREVIEW_ORIGIN to serve them from a dedicated domain."} />
              <Status ok label={`Limits · ${c.limits.generationRatePerMin} generations/min · ${c.limits.agentConcurrency} parallel agents · ${c.limits.maxRepairAttempts} repair attempts`} />
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-medium">Usage · last 30 days</h2>
          {usage && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Model requests", usage.totals.requests.toLocaleString()],
                  ["Failed", usage.totals.failures.toLocaleString()],
                  ["Tokens in / out", `${(usage.totals.inputTokens / 1000).toFixed(1)}k / ${(usage.totals.outputTokens / 1000).toFixed(1)}k`],
                  ["Estimated cost", usage.totals.costKnown ? `$${usage.totals.estimatedCostUsd.toFixed(4)}` : "Not configured"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-border bg-card p-3">
                    <p className="text-xs text-muted-foreground">{k}</p>
                    <p className="mt-1 text-lg font-semibold tracking-tight">{v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-surface text-left text-muted-foreground">
                    <tr>{["When", "Operation", "Model", "Tokens", "Latency", "Request ID", "Result"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {usage.records.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No model requests yet.</td></tr>}
                    {usage.records.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{timeAgo(r.createdAt)}</td>
                        <td className="px-3 py-2 font-mono">{r.operation}</td>
                        <td className="whitespace-nowrap px-3 py-2">{r.provider} · {r.model}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono">{r.inputTokens ?? "—"} / {r.outputTokens ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono">{(r.latencyMs / 1000).toFixed(1)}s</td>
                        <td className="max-w-40 truncate px-3 py-2 font-mono text-muted-foreground" title={r.requestId ?? ""}>{r.requestId ?? "—"}</td>
                        <td className={cn("px-3 py-2", r.success ? "text-success" : "text-destructive")}>{r.success ? "ok" : r.errorCode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
