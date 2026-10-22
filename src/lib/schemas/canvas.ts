import { z } from "zod";

export const CANVAS_NODE_TYPES = ["frame", "section", "text", "rect", "ellipse", "image", "video", "project"] as const;
export const CanvasNodeType = z.enum(CANVAS_NODE_TYPES);
export type CanvasNodeType = z.infer<typeof CanvasNodeType>;

const color = z.string().max(40);

export const CanvasNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: CanvasNodeType,
  name: z.string().max(120),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().min(1).max(20000),
  h: z.number().finite().min(1).max(20000),
  /** Frame that owns this node (moves with it). null = top level. */
  frameId: z.string().nullable(),
  groupId: z.string().nullable(),
  fill: color,
  stroke: color,
  strokeWidth: z.number().min(0).max(100),
  radius: z.number().min(0).max(10000),
  opacity: z.number().min(0).max(1),
  text: z.string().max(10000),
  fontSize: z.number().min(4).max(800),
  fontWeight: z.number().int().min(100).max(900),
  color: color,
  align: z.enum(["left", "center", "right"]),
  /** image: asset url; video: embed url; project: project id */
  src: z.string().max(2000),
  locked: z.boolean(),
  hidden: z.boolean(),
});
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;

export const CanvasPageSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(120),
  nodes: z.array(CanvasNodeSchema).max(5000),
});
export type CanvasPage = z.infer<typeof CanvasPageSchema>;

export const CanvasDocSchema = z.object({
  version: z.literal(1),
  pages: z.array(CanvasPageSchema).min(1).max(50),
  activePageId: z.string(),
});
export type CanvasDoc = z.infer<typeof CanvasDocSchema>;

export function makeNode(type: CanvasNodeType, id: string, over: Partial<CanvasNode> = {}): CanvasNode {
  const base: CanvasNode = {
    id,
    type,
    name: type[0].toUpperCase() + type.slice(1),
    x: 0,
    y: 0,
    w: type === "text" ? 240 : type === "frame" ? 640 : type === "section" ? 1200 : 200,
    h: type === "text" ? 48 : type === "frame" ? 420 : type === "section" ? 700 : 140,
    frameId: null,
    groupId: null,
    fill: type === "frame" ? "#121216" : type === "section" ? "#ffffff08" : type === "text" ? "transparent" : "#2a2a33",
    stroke: type === "section" ? "#ffffff20" : "transparent",
    strokeWidth: type === "section" ? 1 : 0,
    radius: type === "frame" ? 12 : type === "rect" ? 8 : 0,
    opacity: 1,
    text: type === "text" ? "Text" : "",
    fontSize: 24,
    fontWeight: 500,
    color: "#ededf0",
    align: "left",
    src: "",
    locked: false,
    hidden: false,
  };
  return { ...base, ...over };
}

export function emptyCanvas(): CanvasDoc {
  return { version: 1, pages: [{ id: "page-1", name: "Page 1", nodes: [] }], activePageId: "page-1" };
}

/** AI-facing contract for generating the content of one frame. Coordinates are frame-relative. */
export const AiFrameContentSchema = z.object({
  summary: z.string(),
  frameFill: z.string().describe("Background color of the frame, e.g. #0f0f12"),
  nodes: z.array(
    z.object({
      type: z.enum(["text", "rect", "ellipse"]),
      name: z.string(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      fill: z.string().describe("Hex color or 'transparent'"),
      stroke: z.string(),
      strokeWidth: z.number(),
      radius: z.number(),
      opacity: z.number(),
      text: z.string().describe("Text content for type=text, empty otherwise"),
      fontSize: z.number(),
      fontWeight: z.number(),
      color: z.string(),
      align: z.enum(["left", "center", "right"]),
    }),
  ),
});
export type AiFrameContent = z.infer<typeof AiFrameContentSchema>;
