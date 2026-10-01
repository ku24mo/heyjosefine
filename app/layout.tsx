import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "https://www.heyjosefine.com"
  ),
  title: "josefine",
  description:
    "she has a lecture at 8 and a dog who steals socks. she remembers what you told her last tuesday. sometimes she texts first.",
  openGraph: {
    title: "josefine",
    description: "she remembers you.",
    siteName: "josefine",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // messaging-app feel — no pinch zoom on the chat
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full bg-white">{children}</body>
    </html>
  );
}
