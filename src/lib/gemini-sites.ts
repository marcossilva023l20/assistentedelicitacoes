/* Lista de lojas confiáveis + resolução de nome a partir da URL. */

export const TRUSTED_SITES: { host: string; name: string }[] = [
  { host: "amazon.com", name: "Amazon" },
  { host: "mercadolivre.com", name: "Mercado Livre" },
  { host: "mercadolivre.com.br", name: "Mercado Livre" },
  { host: "magazineluiza.com", name: "Magazine Luiza" },
  { host: "magalu.com", name: "Magazine Luiza" },
  { host: "casasbahia.com", name: "Casas Bahia" },
  { host: "lebiscuit.com", name: "Le Biscuit" },
  { host: "shopee.com", name: "Shopee" },
  { host: "br.shein.com", name: "Shein" },
  { host: "shein.com", name: "Shein" },
  { host: "americanas.com", name: "Americanas" },
  { host: "kabum.com", name: "KaBuM!" },
  { host: "pichau.com", name: "Pichau" },
  { host: "extra.com", name: "Extra" },
  { host: "pontofrio.com", name: "Ponto Frio" },
  { host: "ponto.com", name: "Ponto Frio" },
  { host: "fastshop.com", name: "Fast Shop" },
  { host: "submarino.com", name: "Submarino" },
  { host: "carrefour.com", name: "Carrefour" },
  { host: "kalunga.com", name: "Kalunga" },
  { host: "leroymerlin.com", name: "Leroy Merlin" },
  { host: "telhanorte.com", name: "Telhanorte" },
  { host: "madeiramadeira.com", name: "MadeiraMadeira" },
  { host: "mobly.com", name: "Mobly" },
  { host: "webcontinental.com", name: "Webcontinental" },
  { host: "girafa.com", name: "Girafa" },
  { host: "elo7.com", name: "Elo7" },
  { host: "cissamagazine.com", name: "Cissa Magazine" },
  { host: "terabyteshop.com", name: "Terabyte Shop" },
];

export function siteFromUrl(rawUrl: string): { site: string; trusted: boolean } {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    const hit = TRUSTED_SITES.find((s) => host.includes(s.host));
    if (hit) return { site: hit.name, trusted: true };
    const base = host.split(".")[0] ?? host;
    return { site: base.charAt(0).toUpperCase() + base.slice(1), trusted: false };
  } catch {
    return { site: "Loja", trusted: false };
  }
}
