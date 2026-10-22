import { z } from "zod";

export const MEDIA_KINDS = ["image", "video", "audio", "sfx", "model3d", "material"] as const;
export const MediaKind = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof MediaKind>;

export const MEDIA_LABELS: Record<MediaKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Speech",
  sfx: "Sound effect",
  model3d: "3D model",
  material: "Material",
};

export const MediaRequestSchema = z.object({
  kind: MediaKind,
  providerId: z.string().max(40),
  prompt: z.string().min(3).max(4000),
  options: z
    .object({
      aspect: z.enum(["1:1", "3:2", "2:3", "16:9", "9:16"]).optional(),
      quality: z.enum(["low", "medium", "high"]).optional(),
      seconds: z.enum(["4", "8", "12"]).optional(),
      voice: z.string().max(40).optional(),
      format: z.enum(["mp3", "wav", "png", "webp", "jpeg", "glb"]).optional(),
      durationSeconds: z.number().min(0.5).max(22).optional(),
    })
    .default({}),
});
export type MediaRequest = z.infer<typeof MediaRequestSchema>;

export type MediaProviderInfo = {
  id: string;
  label: string;
  kinds: MediaKind[];
  configured: boolean;
  /** Human-readable reason when not configured, e.g. which env var to set. */
  reason: string | null;
  model: string | null;
  notes: string;
};
