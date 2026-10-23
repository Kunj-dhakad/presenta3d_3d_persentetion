import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const SITE_TITLE = "Strata — AI 3D Presentations";
const SITE_DESCRIPTION = "Describe your topic and get a cinematic 3D presentation: AI writes the slides and designs an animated 3D scene for every slide. Present it full screen or share it with a link.";

export const metadata: Metadata = {
  title: { default: SITE_TITLE, template: "%s · Strata" },
  description: SITE_DESCRIPTION,
  // Link previews (email, WhatsApp, Slack, LinkedIn …)
  openGraph: { title: SITE_TITLE, description: SITE_DESCRIPTION, siteName: "Strata", type: "website" },
  twitter: { card: "summary", title: SITE_TITLE, description: SITE_DESCRIPTION },
};

export const viewport: Viewport = { themeColor: "#0b0b0f", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
