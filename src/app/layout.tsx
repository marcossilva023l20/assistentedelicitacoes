import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// Fallback local para ambiente offline (sem acesso a fonts.googleapis.com)
// Em produção com internet, o Next tenta carregar via next/font/google, mas aqui usamos system fonts para não quebrar o build
const inter = { variable: "--font-inter" };
const sora = { variable: "--font-sora" };
const jbmono = { variable: "--font-jbmono" };

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
