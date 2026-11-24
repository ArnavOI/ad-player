import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Product video",
  description: "Watch the product video and switch between products.",
  robots: { index: false, follow: false }, // ads are shared by link, not found through search
  formatDetection: { telephone: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection(); // rendered per request, so every page gets its own CSP nonce
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
