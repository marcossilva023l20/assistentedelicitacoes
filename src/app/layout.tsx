import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Sora, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", display: "swap" });

export const metadata: Metadata = {
  title: "LicitaPreço — Do edital ao menor preço",
  description:
    "Cole o item do edital e receba as 10 melhores ofertas do varejo brasileiro que atendem 100% das especificações, ordenadas pelo menor preço, com links reais.",
};

export const viewport: Viewport = {
  themeColor: "#05080a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${sora.variable} ${jbmono.variable}`}>
      <body className="noise antialiased">{children}</body>
    </html>
  );
}
