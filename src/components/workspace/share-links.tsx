"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";
import { Code2, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

function copy(text: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success("Copied"), () => toast.error("Could not copy"));
}

const SOCIAL: { name: string; href: (url: string, title: string) => string }[] = [
  { name: "WhatsApp", href: (u, t) => `https://wa.me/?text=${encodeURIComponent(`${t} ${u}`)}` },
  { name: "Facebook", href: (u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}` },
  { name: "LinkedIn", href: (u) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}` },
  { name: "X", href: (u, t) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}` },
  { name: "Email", href: (u, t) => `mailto:?subject=${encodeURIComponent(t)}&body=${encodeURIComponent(u)}` },
];

/**
 * Ways to pass on a published presentation: social networks, a QR code for
 * its public page, and an embed code for other websites. `url` is the public
 * page; `embedUrl` the deck itself (it may be framed by any site).
 */
export function ShareLinks({ url, embedUrl, title }: { url: string; embedUrl: string; title: string }) {
  const qr = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(url);
    code.make();
    return code.createDataURL(6, 2);
  }, [url]);
  const embed = `<iframe src="${embedUrl}" title="${title.replace(/["<>&]/g, "")}" width="960" height="540" style="border:0;max-width:100%;aspect-ratio:16/9;height:auto" allow="fullscreen" allowfullscreen loading="lazy"></iframe>`;

  return (
    <div className="grid min-w-0 gap-3 rounded-lg border border-border p-3 text-sm">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Share on</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SOCIAL.map((s) => (
            <Button key={s.name} size="xs" variant="secondary" asChild>
              <a href={s.href(url, title)} target="_blank" rel="noopener noreferrer">{s.name}</a>
            </Button>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
        <div className="flex shrink-0 flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL */}
          <img src={qr} alt="QR code of the public link" width={132} height={132} className="rounded-md bg-white p-1" />
          <Button size="xs" variant="ghost" asChild>
            <a href={qr} download="presentation-qr.gif"><Download /> Download QR</a>
          </Button>
        </div>
        <div className="grid min-w-0 flex-1 content-start gap-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Code2 className="size-3.5" /> Embed on your website</p>
          <textarea readOnly value={embed} rows={4} onFocus={(e) => e.currentTarget.select()} className="w-full resize-none rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-snug" aria-label="Embed code" />
          <Button size="xs" variant="secondary" className="justify-self-start" onClick={() => copy(embed)}><Copy /> Copy embed code</Button>
        </div>
      </div>
    </div>
  );
}
