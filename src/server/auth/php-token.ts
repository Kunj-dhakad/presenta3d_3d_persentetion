import "server-only";
import { createDecipheriv } from "node:crypto";
import { db } from "@/server/db/client";
import { env } from "@/server/env";

/**
 * There is no login here: the app runs inside the PHP app's (CI_Core) iframe,
 * which hands it the user's access token (INIT_DATA). PHP makes the token
 * with encrypt_user_token() (application/helpers/tokengenerate_helper.php):
 *
 *   base64( iv[16] . base64( AES-256-CBC("user_id=2:business_id=2") ) )
 *
 * PHP's openssl pads the passphrase with NUL bytes to the 32-byte key, so the
 * same key is rebuilt here. The client sends the token in this header.
 */
export const TOKEN_HEADER = "x-access-token";

export type SessionUser = { id: string; email: string; name: string };
export type PhpIdentity = { userId: string; businessId: string };

function key() {
  const secret = Buffer.alloc(32);
  Buffer.from(env().PHP_TOKEN_KEY ?? "your-256-bit-secret").copy(secret);
  return secret;
}

export function decodePhpToken(token: string): PhpIdentity | null {
  if (!token || token.length > 512) return null;
  try {
    const raw = Buffer.from(token, "base64");
    if (raw.length < 17) return null;
    const decipher = createDecipheriv("aes-256-cbc", key(), raw.subarray(0, 16));
    const encrypted = Buffer.from(raw.subarray(16).toString("latin1"), "base64");
    const text = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const fields = Object.fromEntries(text.split(":").map((part) => part.split("=") as [string, string]));
    const userId = String(fields.user_id ?? "");
    const businessId = String(fields.business_id ?? "");
    if (!/^\d+$/.test(userId) || !/^\d+$/.test(businessId)) return null;
    return { userId, businessId };
  } catch {
    return null;
  }
}

/** The p3d_users row of a PHP user ("<business_id>_<user_id>"); PHP lists presentations by this owner id. */
export function ownerIdFor(identity: PhpIdentity): string {
  return `${identity.businessId}_${identity.userId}`;
}

// Rows are created once per user; remember them for the life of the process.
const known = new Map<string, Promise<SessionUser>>();

export function userForToken(token: string | null | undefined): Promise<SessionUser> | null {
  const identity = token ? decodePhpToken(token) : null;
  if (!identity) return null;
  const id = ownerIdFor(identity);
  let user = known.get(id);
  if (!user) {
    const select = { id: true, email: true, name: true } as const;
    user = db.user
      .upsert({
        where: { id },
        update: {},
        create: { id, email: `user${identity.userId}.business${identity.businessId}@php.local`, name: `User ${identity.userId}`, passwordHash: "!php-token" },
        select,
      })
      .catch((err) => {
        known.delete(id);
        throw err;
      });
    known.set(id, user);
  }
  return user;
}
