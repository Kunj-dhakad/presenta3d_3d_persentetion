import "server-only";
import { db } from "@/server/db/client";
import type { Prisma } from "@/generated/mysql-prisma/client";

/** Append-only audit log for sensitive actions. Never pass secrets or file contents in `meta`. */
export async function audit(
  userId: string | null,
  action: string,
  target?: { type: string; id: string },
  meta?: Prisma.InputJsonValue,
  ip?: string,
) {
  try {
    await db.auditLog.create({
      data: { userId, action, targetType: target?.type ?? null, targetId: target?.id ?? null, meta: meta ?? undefined, ip: ip ?? null },
    });
  } catch (err) {
    console.error("[audit] failed to record", action, err instanceof Error ? err.message : "");
  }
}
