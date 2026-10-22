import { Presentation, Sparkles, type LucideIcon } from "lucide-react";
// Hidden in the simplified presentation product (pages still exist; re-add to NAV_ITEMS to show them):
// import { Boxes, PenTool, Images, Settings } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; description: string };

export const NAV_ITEMS: NavItem[] = [
  { href: "/chat", label: "New presentation", icon: Sparkles, description: "Describe a topic in chat and get a cinematic 3D presentation" },
  { href: "/projects", label: "Presentations", icon: Presentation, description: "All your presentations: open, present, publish, rename or delete" },
  // { href: "/studio", label: "Studio", icon: Boxes, description: "3D scene editor and image, video, audio and model generation" },
  // { href: "/canvas", label: "Canvas", icon: PenTool, description: "Infinite design canvas with frames, shapes, text and AI layout" },
  // { href: "/assets", label: "Assets", icon: Images, description: "Uploaded and generated images, audio, video and 3D models" },
  // { href: "/settings", label: "Settings", icon: Settings, description: "Account, AI configuration status and usage" },
];

export const HELP: Record<string, { title: string; tips: string[] }> = {
  "/chat": {
    title: "Create a presentation",
    tips: [
      "Describe your topic, audience and tone. The AI writes the story and picks a 3D scene for every slide.",
      "Ask for changes in plain language, e.g. “make slide 3 a stats slide” or “use warmer colours”.",
      "Click the preview (or use the arrow keys) to move between slides. Press F for fullscreen and N for speaker notes.",
      "Present opens the deck full page. Publish gives you a link you can open or share.",
    ],
  },
  "/projects": { title: "Presentations", tips: ["Open a presentation to keep editing it in chat, or use Present to show it full page.", "Rename, duplicate or delete from the ⋯ menu."] },
  "/present": { title: "Presenting", tips: ["Arrow keys or click to move between slides. F for fullscreen, N for speaker notes, Esc to exit fullscreen."] },
};
