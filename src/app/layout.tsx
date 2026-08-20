import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { AriaProviders } from "@/components/providers/aria-providers";

// Geist — modern geometric sans-serif (same as Skills Studio landing page).
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

// Geist Mono — for code/mono elements.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ARIA Mission Control — Autonomous AI Operations",
  description:
    "Mission-critical control panel for an autonomous AI company. 66 AI agents across 15 departments, real-time telemetry, multi-provider LLM routing, and self-healing oversight.",
  keywords: ["ARIA", "Mission Control", "Autonomous AI", "Agent Orchestration", "LLM Routing"],
  authors: [{ name: "ARIA Systems" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen flex flex-col`}
      >
        <AriaProviders>{children}</AriaProviders>
        <Toaster />
        <SonnerToaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
