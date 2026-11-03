import type { Metadata, Viewport } from "next";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// The PHP app's font, so the editor inside it looks like the same product.
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const SITE_TITLE = "Present 3D — create cinematic presentations with AI";
const SITE_DESCRIPTION = "Describe your topic and get a cinematic 3D presentation: AI writes the slides and designs an animated 3D scene for every slide. Present it full screen or share it with a link.";

export const metadata: Metadata = {
  title: { default: SITE_TITLE, template: "%s · Present 3D" },
  description: SITE_DESCRIPTION,
  // Link previews (email, WhatsApp, Slack, LinkedIn …)
  openGraph: { title: SITE_TITLE, description: SITE_DESCRIPTION, siteName: "Present 3D", type: "website" },
  twitter: { card: "summary", title: SITE_TITLE, description: SITE_DESCRIPTION },
};

export const viewport: Viewport = { themeColor: "#f4f8fb", colorScheme: "light" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
