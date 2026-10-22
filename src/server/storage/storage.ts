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
  list(prefix: string): Promise<string[]>;
  deletePrefix(prefix: string): Promise<void>;
}

const KEY_RE = /^(?:[A-Za-z0-9_@+.-]+\/)*[A-Za-z0-9_@+.-]+$/;
const MEDIA_KEY_RE = /^[A-Za-z0-9_@+.-]+\/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9]{1,8}$/;
export function assertStorageKey(key: string) {
  if (key.length > 1024 || !MEDIA_KEY_RE.test(key) || key.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("invalid storage key");
  }
}

function assertArtifactKey(key: string) {
  if (key.length > 1024 || !KEY_RE.test(key) || key.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("invalid storage key");
  }
}

function normalizePrefix(prefix: string) {
  const normalized = prefix.replace(/\/+$/, "");
  assertArtifactKey(normalized);
  return `${normalized}/`;
}

function isArtifactKey(key: string) {
  return /^(?:previews|runtime|sites)\//.test(key);
}

async function walkLocal(dir: string, prefix: string, root: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const keys: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) keys.push(...(await walkLocal(abs, prefix, root)));
    else if (entry.isFile()) keys.push(`${prefix}${path.relative(root, abs).split(path.sep).join("/")}`);
  }
  return keys;
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly driver = "local";
  private file(key: string) {
    if (isArtifactKey(key)) assertArtifactKey(key);
    else assertStorageKey(key);
    return isArtifactKey(key) ? dataPath(...key.split("/")) : dataPath("storage", ...key.split("/"));
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
  async list(prefix: string) {
    const normalized = normalizePrefix(prefix);
    const root = isArtifactKey(normalized) ? dataPath(...normalized.slice(0, -1).split("/")) : dataPath("storage", ...normalized.slice(0, -1).split("/"));
    return walkLocal(root, normalized, root);
  }
  async deletePrefix(prefix: string) {
    const normalized = normalizePrefix(prefix);
    const root = isArtifactKey(normalized) ? dataPath(...normalized.slice(0, -1).split("/")) : dataPath("storage", ...normalized.slice(0, -1).split("/"));
    await fs.rm(root, { recursive: true, force: true });
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

  private bucketUrl() {
    const base = this.cfg.endpoint ? `${this.cfg.endpoint.replace(/\/$/, "")}/${this.cfg.bucket}` : `https://${this.cfg.bucket}.s3.${this.cfg.region}.amazonaws.com`;
    return new URL(`${base}/`);
  }

  private url(key: string) {
    if (isArtifactKey(key)) assertArtifactKey(key);
    else assertStorageKey(key);
    const url = this.bucketUrl();
    url.pathname += key.split("/").map(encodeURIComponent).join("/");
    return url;
  }

  private async request(method: string, url: URL, body?: Uint8Array, contentType?: string) {
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
    const r = await this.request("PUT", this.url(key), data, contentType);
    if (!r.ok) throw new Error(`S3 put failed (${r.status})`);
  }
  async get(key: string) {
    const r = await this.request("GET", this.url(key));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`S3 get failed (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async delete(key: string) {
    const r = await this.request("DELETE", this.url(key));
    if (!r.ok && r.status !== 404) throw new Error(`S3 delete failed (${r.status})`);
  }

  async list(prefix: string) {
    const normalized = normalizePrefix(prefix);
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const url = this.bucketUrl();
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", normalized);
      if (continuationToken) url.searchParams.set("continuation-token", continuationToken);
      const r = await this.request("GET", url);
      if (!r.ok) throw new Error(`S3 list failed (${r.status})`);
      const xml = await r.text();
      for (const match of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) keys.push(decodeXml(match[1]));
      const nextToken = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1];
      continuationToken = nextToken ? decodeXml(nextToken) : undefined;
      if (xml.match(/<IsTruncated>([\s\S]*?)<\/IsTruncated>/)?.[1] !== "true") continuationToken = undefined;
    } while (continuationToken);
    return keys;
  }

  async deletePrefix(prefix: string) {
    for (const key of await this.list(prefix)) await this.delete(key);
  }
}

function decodeXml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

let adapter: StorageAdapter | null = null;
export function storage(): StorageAdapter {
  if (adapter) return adapter;
  const e = env();
  if (e.STORAGE_DRIVER === "s3") {
    const bucket = e.KD_AWS_S3_BUCKET_NAME ?? e.S3_BUCKET;
    const region = e.KD_AWS_REGION ?? e.S3_REGION;
    const accessKeyId = e.KD_AWS_ACCESS_KEY_ID ?? e.S3_ACCESS_KEY_ID;
    const secretAccessKey = e.KD_AWS_SECRET_ACCESS_KEY ?? e.S3_SECRET_ACCESS_KEY;
    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      throw new Error("STORAGE_DRIVER=s3 requires KD_AWS_S3_BUCKET_NAME, KD_AWS_REGION, KD_AWS_ACCESS_KEY_ID and KD_AWS_SECRET_ACCESS_KEY (or their S3_* equivalents)");
    }
    adapter = new S3StorageAdapter({ bucket, region, endpoint: e.S3_ENDPOINT, accessKeyId, secretAccessKey });
  } else adapter = new LocalStorageAdapter();
  return adapter;
}
