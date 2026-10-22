import { db } from "@/server/db/client";
import { api, HttpError } from "@/server/http/api";
import { storage } from "@/server/storage/storage";
import { assetTypeForMime, newStorageKey } from "@/server/services/media";
import { audit } from "@/server/audit";

const MAX_UPLOAD = 25 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "model/gltf-binary": "glb",
};

/** Verify the file's magic bytes match the declared type (do not trust the browser's MIME type). */
function sniff(buf: Uint8Array, mime: string): boolean {
  const b = (i: number) => buf[i];
  const ascii = (start: number, s: string) => [...s].every((c, i) => buf[start + i] === c.charCodeAt(0));
  switch (mime) {
    case "image/png":
      return b(0) === 0x89 && ascii(1, "PNG");
    case "image/jpeg":
      return b(0) === 0xff && b(1) === 0xd8;
    case "image/gif":
      return ascii(0, "GIF8");
    case "image/webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "audio/wav":
    case "audio/x-wav":
      return ascii(0, "RIFF") && ascii(8, "WAVE");
    case "audio/mpeg":
      return ascii(0, "ID3") || (b(0) === 0xff && (b(1) & 0xe0) === 0xe0);
    case "video/mp4":
      return ascii(4, "ftyp");
    case "video/webm":
      return b(0) === 0x1a && b(1) === 0x45 && b(2) === 0xdf && b(3) === 0xa3;
    case "model/gltf-binary":
      return ascii(0, "glTF");
    default:
      return false;
  }
}

export const GET = api(async ({ req, user }) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const q = url.searchParams.get("q")?.trim().slice(0, 100);
  const assets = await db.asset.findMany({
    where: { ownerId: user.id, ...(type ? { type } : {}), ...(q ? { name: { contains: q } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return {
    assets: assets.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      mimeType: a.mimeType,
      size: a.size,
      source: a.source,
      prompt: a.prompt,
      provider: a.provider,
      createdAt: a.createdAt,
      url: `/api/assets/${a.id}`,
    })),
  };
});

/** Upload an asset (multipart/form-data, field "file"). */
export const POST = api(
  async ({ req, user, ip }) => {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_UPLOAD + 64 * 1024) throw new HttpError(413, "Files must be 25 MB or smaller", "PAYLOAD_TOO_LARGE");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Missing file", "BAD_REQUEST");
    if (file.size > MAX_UPLOAD) throw new HttpError(413, "Files must be 25 MB or smaller", "PAYLOAD_TOO_LARGE");
    const mime = file.type === "" && file.name.toLowerCase().endsWith(".glb") ? "model/gltf-binary" : file.type;
    const ext = ALLOWED[mime];
    if (!ext) throw new HttpError(415, "Unsupported file type. Allowed: PNG, JPEG, WebP, GIF, MP3, WAV, MP4, WebM, GLB", "UNSUPPORTED_TYPE");
    const data = new Uint8Array(await file.arrayBuffer());
    if (!sniff(data, mime)) throw new HttpError(415, "The file contents do not match its type", "UNSUPPORTED_TYPE");
    const storageKey = newStorageKey(user.id, ext);
    await storage().put(storageKey, data, mime);
    const asset = await db.asset.create({
      data: {
        ownerId: user.id,
        name: (form.get("name")?.toString() || file.name).slice(0, 120),
        type: mime === "model/gltf-binary" ? "model3d" : assetTypeForMime(mime),
        mimeType: mime,
        size: data.length,
        storageKey,
        source: "upload",
      },
    });
    await audit(user.id, "asset.upload", { type: "asset", id: asset.id }, { mime, size: data.length }, ip);
    return { asset: { id: asset.id, name: asset.name, type: asset.type, mimeType: asset.mimeType, size: asset.size, url: `/api/assets/${asset.id}` } };
  },
  { rateLimit: { bucket: "upload", perMinute: 30 } },
);
