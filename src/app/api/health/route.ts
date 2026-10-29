import { connection } from "next/server";
import { env } from "@/server/env";

// Every table in prisma/mysql/schema.prisma (application/sql/p3d_tables.sql in CI_Core).
const TABLES = [
  "p3d_users", "p3d_projects", "p3d_project_files", "p3d_project_versions", "p3d_builds", "p3d_conversations",
  "p3d_chat_messages", "p3d_generation_jobs", "p3d_assets", "p3d_canvas_documents", "p3d_canvas_versions",
  "p3d_share_links", "p3d_deployments", "p3d_usage_records", "p3d_audit_logs",
];

/**
 * Setup check for the hosted app: which settings are present, whether the core
 * MySQL database answers and has the p3d_* tables. Shows only names and error
 * codes, never values, hosts or passwords.
 */
export async function GET() {
  await connection(); // check on every request, never at build time
  const report: Record<string, unknown> = {};
  try {
    const e = env();
    report.settings = Object.fromEntries(
      ["MYSQL_HOST", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "OPENAI_API_KEY", "PHP_TOKEN_KEY", "KD_AWS_S3_BUCKET_NAME", "KD_AWS_ACCESS_KEY_ID", "S3_BUCKET", "S3_ACCESS_KEY_ID"]
        .map((name) => [name, Boolean(e[name as keyof typeof e])]),
    );
    // Which database and bucket are in use, without revealing hosts or keys.
    report.target = {
      mysqlHostIsPresent3d: /(^|\.)present3d\.com$/i.test(e.MYSQL_HOST ?? ""),
      mysqlDatabase: e.MYSQL_DATABASE ?? null,
      storage: e.STORAGE_DRIVER,
      bucket: e.KD_AWS_S3_BUCKET_NAME ?? e.S3_BUCKET ?? null,
      prefix: e.S3_ROOT_PREFIX,
    };
  } catch (err) {
    report.settings = { error: err instanceof Error ? err.message.slice(0, 300) : "invalid settings" };
    return Response.json(report, { status: 500 });
  }

  const started = Date.now();
  try {
    const { db } = await import("@/server/db/client");
    const [version] = await db.$queryRawUnsafe<{ v: string }[]>("SELECT VERSION() AS v");
    const rows = await db.$queryRawUnsafe<{ t: string }[]>(
      "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'p3d\\_%'",
    );
    const found = new Set(rows.map((r) => r.t));
    report.database = { ok: true, ms: Date.now() - started, mysql: version?.v, missingTables: TABLES.filter((t) => !found.has(t)) };
  } catch (err) {
    const e = err as { code?: string; errno?: number; name?: string; message?: string; cause?: { code?: string; errno?: number } };
    report.database = {
      ok: false,
      ms: Date.now() - started,
      code: e.cause?.code ?? e.code ?? e.name,
      errno: e.cause?.errno ?? e.errno,
      // the driver's message names the failure (access denied, timeout, unknown table) without secrets
      message: e.message?.replace(/(password|pwd)[^\s,)]*/gi, "***").replace(/\d{1,3}(\.\d{1,3}){3}(:\d+)?/g, "<ip>").slice(0, 300),
    };
  }
  const ok = (report.database as { ok: boolean }).ok;
  return Response.json(report, { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
