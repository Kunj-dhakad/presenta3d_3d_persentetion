import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import { env } from "@/server/env";
import { dataPath } from "./paths";

/**
 * Object storage for binary assets. Keys are generated server-side
 * (`<ownerId>/<random>.<ext>`), never taken from user input.
 */
export interface StorageAdapter {
  readonly driver: string;
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{8,64}\.[a-z0-9]{1,8}$/;
export function assertStorageKey(key: string) {
  if (!KEY_RE.test(key)) throw new Error("invalid storage key");
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly driver = "local";
  private file(key: string) {
    assertStorageKey(key);
    return dataPath("storage", ...key.split("/"));
  }
  async put(key: string, data: Uint8Array) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data);
  }
  async get(key: string) {
    try {
      return new Uint8Array(await fs.readFile(this.file(key)));
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await fs.rm(this.file(key), { force: true });
  }
}

// ─── S3-compatible adapter (AWS S3, R2, MinIO …) with SigV4 signing ───────

const sha256hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

export function signV4(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  amzDate: string; // YYYYMMDDTHHMMSSZ
}): string {
  const service = input.service ?? "s3";
  const date = input.amzDate.slice(0, 8);
  const lower = Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const signedHeaders = Object.keys(lower).sort();
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${lower[h]}\n`).join("");
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalPath = input.url.pathname
    .split("/")
    .map((s) => encodeURIComponent(decodeURIComponent(s)))
    .join("/");
  const canonicalRequest = [input.method, canonicalPath, query, canonicalHeaders, signedHeaders.join(";"), input.payloadHash].join("\n");
  const scope = `${date}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.secretAccessKey}`, date);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`;
}

export class S3StorageAdapter implements StorageAdapter {
  readonly driver = "s3";
  constructor(
    private cfg: { bucket: string; region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string },
  ) {}

  private url(key: string) {
    assertStorageKey(key);
    const base = this.cfg.endpoint ? `${this.cfg.endpoint.replace(/\/$/, "")}/${this.cfg.bucket}` : `https://${this.cfg.bucket}.s3.${this.cfg.region}.amazonaws.com`;
    return new URL(`${base}/${key}`);
  }

  private async request(method: string, key: string, body?: Uint8Array, contentType?: string) {
    const url = this.url(key);
    const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const payloadHash = body ? sha256hex(body) : sha256hex("");
    const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
    if (contentType) headers["content-type"] = contentType;
    const authorization = signV4({ method, url, headers, payloadHash, accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey, region: this.cfg.region, amzDate });
    const { host: _host, ...sendHeaders } = headers;
    void _host;
    return fetch(url, { method, headers: { ...sendHeaders, authorization }, body: body ? Buffer.from(body) : undefined });
  }

  async put(key: string, data: Uint8Array, contentType: string) {
    const r = await this.request("PUT", key, data, contentType);
    if (!r.ok) throw new Error(`S3 put failed (${r.status})`);
  }
  async get(key: string) {
    const r = await this.request("GET", key);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`S3 get failed (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async delete(key: string) {
    const r = await this.request("DELETE", key);
    if (!r.ok && r.status !== 404) throw new Error(`S3 delete failed (${r.status})`);
  }
}

let adapter: StorageAdapter | null = null;
export function storage(): StorageAdapter {
  if (adapter) return adapter;
  const e = env();
  if (e.STORAGE_DRIVER === "s3") {
    if (!e.S3_BUCKET || !e.S3_REGION || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) {
      throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
    }
    adapter = new S3StorageAdapter({ bucket: e.S3_BUCKET, region: e.S3_REGION, endpoint: e.S3_ENDPOINT, accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY });
  } else adapter = new LocalStorageAdapter();
  return adapter;
}
