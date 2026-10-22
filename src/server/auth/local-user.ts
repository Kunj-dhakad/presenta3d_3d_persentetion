import "server-only";
import { db } from "@/server/db/client";

export type LocalUser = { id: string; email: string; name: string };

const LOCAL_EMAIL = "local@strata.local";
let localUser: Promise<LocalUser> | null = null;

/** The single user of local mode (created on first use; it has no usable password). */
export function localModeUser(): Promise<LocalUser> {
  localUser ??= (async () => {
    const existing = await db.user.findUnique({ where: { email: LOCAL_EMAIL }, select: { id: true, email: true, name: true } });
    if (existing) return existing;
    return db.user.create({ data: { email: LOCAL_EMAIL, name: "Local user", passwordHash: "!local-mode-no-password" }, select: { id: true, email: true, name: true } });
  })().catch((err) => {
    localUser = null;
    throw err;
  });
  return localUser;
}
