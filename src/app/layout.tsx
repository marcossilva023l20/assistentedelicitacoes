import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "LicitaPreço — Do edital ao menor preço",
  description:
    "Cole o item do edital e receba as 10 melhores ofertas do varejo brasileiro que atendem 100% das especificações, ordenadas pelo menor preço, com links reais.",
};

export const viewport: Viewport = {
  themeColor: "#05080a",
};

/**
 * As fontes vêm do Google Fonts em tempo de NAVEGAÇÃO (via <link>), e não em tempo
 * de build (`next/font/google`). Motivo: o build baixava os .woff2 do Google e
 * quebrava (`Failed to fetch Inter from Google Fonts`) em CI/deploy sem acesso —
 * agora a compilação é independente de rede e, se a CDN falhar, o CSS cai nas
 * fontes do sistema (ver fallbacks em globals.css).
 */
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONT_HREF} />
      </head>
      <body className="noise antialiased">{children}</body>
    </html>
  );
}
