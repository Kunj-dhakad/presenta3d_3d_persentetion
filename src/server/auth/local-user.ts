import "server-only";
import { db } from "@/server/db/client";

export type LocalUser = { id: string; email: string; name: string };

const LOCAL_EMAIL = "local@deck3d.local";
const SELECT = { id: true, email: true, name: true } as const;
let localUser: Promise<LocalUser> | null = null;

/** The single user of local mode (created on first use; it has no usable password). */
export function localModeUser(): Promise<LocalUser> {
  localUser ??= (async () => {
    const existing = await db.user.findUnique({ where: { email: LOCAL_EMAIL }, select: SELECT });
    if (existing) return existing;
    // The local user of an earlier version of the app had a different domain
    // (local@<old-name>.local). Rename it so its presentations stay with it.
    const previous = await db.user.findFirst({
      where: { email: { startsWith: "local@", endsWith: ".local" }, passwordHash: "!local-mode-no-password" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (previous) return db.user.update({ where: { id: previous.id }, data: { email: LOCAL_EMAIL }, select: SELECT });
    return db.user.create({ data: { email: LOCAL_EMAIL, name: "Local user", passwordHash: "!local-mode-no-password" }, select: SELECT });
  })().catch((err) => {
    localUser = null;
    throw err;
  });
  return localUser;
}
