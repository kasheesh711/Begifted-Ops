import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BeGifted Credit Control",
  description: "Credit control dashboard migrated to Next.js and Vercel.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
