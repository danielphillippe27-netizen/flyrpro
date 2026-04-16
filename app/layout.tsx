import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import 'mapbox-gl/dist/mapbox-gl.css';
import { ThemeProvider } from "@/lib/theme-provider";
import { PwaRegister } from '@/components/pwa/PwaRegister';
import { Toaster } from '@/components/ui/sonner';

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.flyrpro.app"),
  manifest: '/manifest.webmanifest',
  title: {
    default: "FLYR",
    template: "%s | FLYR",
  },
  description: "Door-to-door software",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "FLYR",
    description: "Door-to-door software",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "FLYR",
    description: "Door-to-door software",
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
      >
        <ThemeProvider>
          <PwaRegister />
          <Toaster richColors position="top-right" />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
