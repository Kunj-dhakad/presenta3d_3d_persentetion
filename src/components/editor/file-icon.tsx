import { FileCode2, FileJson, FileText, FileType2, Image as ImageIcon, Palette, Globe } from "lucide-react";
import { extname } from "@/lib/vfs/paths";
import { cn } from "@/lib/utils";

export function FileIcon({ path, className }: { path: string; className?: string }) {
  const ext = extname(path);
  const cls = cn("size-3.5 shrink-0", className);
  switch (ext) {
    case "ts":
    case "tsx":
      return <FileCode2 className={cn(cls, "text-sky-400")} />;
    case "js":
    case "jsx":
    case "mjs":
      return <FileCode2 className={cn(cls, "text-amber-300")} />;
    case "html":
    case "htm":
      return <Globe className={cn(cls, "text-orange-400")} />;
    case "css":
      return <Palette className={cn(cls, "text-violet-300")} />;
    case "json":
    case "webmanifest":
      return <FileJson className={cn(cls, "text-emerald-300")} />;
    case "svg":
      return <ImageIcon className={cn(cls, "text-pink-300")} />;
    case "md":
      return <FileType2 className={cn(cls, "text-muted-foreground")} />;
    default:
      return <FileText className={cn(cls, "text-muted-foreground")} />;
  }
}
