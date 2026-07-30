import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import 'mapbox-gl/dist/mapbox-gl.css';
import { ThemeProvider } from "@/lib/theme-provider";
import { MapStyleProvider } from '@/lib/map-style-provider';
import { PwaRegister } from '@/components/pwa/PwaRegister';
import { Toaster } from '@/components/ui/sonner';

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL("https://wolfgrid.app"),
  manifest: '/manifest.webmanifest',
  title: {
    default: "WolfGrid — Field Prospecting, Connected",
    template: "%s | WolfGrid",
  },
  description: "Plan territories, guide field reps, record every conversation, and turn prospecting activity into a connected system.",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "WolfGrid — Field Prospecting, Connected",
    description: "Plan territories, guide field reps, record every conversation, and turn prospecting activity into a connected system.",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "WolfGrid — Field Prospecting, Connected",
    description: "Plan territories, guide field reps, record every conversation, and turn prospecting activity into a connected system.",
    images: ["/twitter-image"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <MapStyleProvider>
            <PwaRegister />
            <Toaster richColors position="top-right" />
            {children}
          </MapStyleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
