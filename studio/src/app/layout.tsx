import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Great_Vibes, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-cormorant", display: "swap" });
const script = Great_Vibes({ subsets: ["latin"], weight: "400", variable: "--font-script-face", display: "swap" });

export const metadata: Metadata = {
  title: "AlphaHome Creative Studio",
  description: "Estúdio privado de direção criativa da AlphaHome Ambientes Planejados.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1b1714" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${cormorant.variable} ${script.variable}`}>
      <body>{children}</body>
    </html>
  );
}
