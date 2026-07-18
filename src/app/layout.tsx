import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { getBrandingConfig } from "@/lib/branding";
import ActionTrackerProvider from "@/components/jarvis/ActionTrackerProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** generateMetadata — pulls live branding from DB so document <title>,
 * description, and favicon all reflect the operator's chosen identity.
 * Falls back to ARIA defaults if the DB row is missing. */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBrandingConfig();
  return {
    title: branding.metaTitle,
    description: branding.metaDescription,
    keywords: [
      branding.appName,
      branding.codename,
      branding.fullName,
      "Mission Control",
      "AI Agents",
      "Autonomous",
      "Orchestration",
      "GLM-4.6",
      "Next.js",
      "Dashboard",
    ],
    authors: [{ name: branding.owner }],
    icons: {
      icon: branding.logoUrl,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ActionTrackerProvider>{children}</ActionTrackerProvider>
        <Toaster />
      </body>
    </html>
  );
}
