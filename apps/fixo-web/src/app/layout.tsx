import type { Metadata, Viewport } from "next";
import { Geist, Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Fixo - AI Vehicle Diagnostics",
    template: "%s | Fixo",
  },
  description:
    "AI-powered vehicle diagnostics. Describe your car problem, snap a photo, or enter OBD codes for instant expert analysis.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Fixo",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans", geist.variable)}
    >
      <body
        className={`${inter.variable} font-sans antialiased bg-background text-text min-h-dvh`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
