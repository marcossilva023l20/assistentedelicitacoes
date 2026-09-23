import "server-only";
import { siteFromUrl, TRUSTED_SITES } from "@/lib/gemini-sites";

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type PriceOrigin = "pagina" | "busca" | "busca_loja" | "comparador";

export interface Candidate {
  id: number;
  site: string;
  url: string;
  name: string;
  brand: string | null;
  price: number;
  /** true = preço lido na própria página/lista da loja; false = visto no resultado de busca */
  confirmed: boolean;
  origin: PriceOrigin;
  snippet: string;
}

export interface SourceRef {
  uri: string;
  title: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Cabeçalhos completos de navegador — vários sites recusam requisições "cruas". */
const FETCH_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

async function fetchText(url: string, timeoutMs = 15000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseBRL(raw: string): number | null {
  let s = raw.replace(/R\$/g, "").replace(/\s/g, "").trim();
  if (!s) return null;
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  else if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ------------------------------------------------------------------ */
/* Bing: decodifica links reais dos resultados                         */
/* ------------------------------------------------------------------ */

function decodeBingRedirect(href: string): string | null {
  try {
    const u = new URL(href.replace(/&amp;/g, "&"));
    if (!u.hostname.includes("bing.com")) return href.startsWith("http") ? href : null;
    if (!u.pathname.startsWith("/ck/")) return null;
    const enc = u.searchParams.get("u");
    if (!enc) return null;
    const b64 = enc.startsWith("a1") ? enc.slice(2) : enc;
    const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    return decoded.startsWith("http") ? decoded : null;
  } catch {
    return null;
  }
}

interface BingResult {
  url: string;
  title: string;
  snippet: string;
}

export async function bingSearch(query: string, maxResults = 10): Promise<BingResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=pt-BR&cc=br&count=${maxResults + 6}`;
  const html = await fetchText(url);
  if (!html) return [];

  const blocks = html.split(/<li class="b_algo"/);
  const out: BingResult[] = [];
  for (const block of blocks.slice(1)) {
    const hrefMatches = [...block.matchAll(/<a[^>]+href="([^"]+)"/g)].map((m) => m[1]);
    let realUrl: string | null = null;
    for (const href of hrefMatches) {
      realUrl = decodeBingRedirect(href);
      if (realUrl && !realUrl.includes("bing.com") && !realUrl.includes("microsoft.com")) break;
      realUrl = null;
    }
    if (!realUrl) continue;

    const h2 = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const title = h2 ? stripTags(h2[1]) : "";
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = p ? stripTags(p[1]) : "";
    if (!title) continue;
    out.push({ url: realUrl, title, snippet });
    if (out.length >= maxResults) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Walker genérico: acha objetos com nome + preço dentro de JSON       */
/* ------------------------------------------------------------------ */

interface WalkedProduct {
  name: string;
  price: number;
  brand: string | null;
  url: string | null;
  code: string | null;
}

function walkForProducts(node: unknown, out: WalkedProduct[], depth: number, budget: { n: number }) {
  if (budget.n <= 0 || depth > 14 || out.length >= 80 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      walkForProducts(item, out, depth + 1, budget);
      if (budget.n-- <= 0) return;
    }
    return;
  }
  if (typeof node !== "object") return;
  budget.n--;

  const obj = node as Record<string, unknown>;
  const nameRaw = obj.name ?? obj.productName ?? obj.title;
  const priceRaw = obj.price ?? obj.bestPrice ?? obj.Price ?? obj.salePrice;
  const price =
    typeof priceRaw === "number" ? priceRaw : typeof priceRaw === "string" ? parseBRL(priceRaw) : null;

  if (typeof nameRaw === "string" && nameRaw.trim().length >= 12 && price != null && price > 1) {
    const brandRaw = obj.brand;
    const brand =
      typeof brandRaw === "string"
        ? brandRaw
        : brandRaw && typeof brandRaw === "object"
          ? ((brandRaw as Record<string, unknown>).name as string | undefined) ?? null
          : null;

    let url: string | null = null;
    let code: string | null = null;
    const isMediaUrl = (s: string) =>
      /\.(jpe?g|png|webp|gif|svg|mp4)(\?|$)/i.test(s) || /\/fotos?\/|images?\.|\/img\//i.test(s);
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== "string" && typeof v !== "number") continue;
      const s = String(v);
      if (isMediaUrl(s)) continue;
      if (!url && /^https?:\/\/.{10,}/.test(s)) url = s;
      if (!url && /^\//.test(s) && s.length > 12 && !s.startsWith("/busca") && /[a-z]/i.test(s)) url = s;
      if (!url && /^(link|linktext|slug)$/i.test(k) && /^[a-z0-9][a-z0-9\-/]{8,}$/i.test(s)) url = s;
      if (!code && /^(code|id|productid|sku)$/i.test(k) && /^\d{4,12}$/.test(s)) code = s;
    }
    out.push({ name: nameRaw, price, brand: brand ?? null, url, code });
  }

  for (const v of Object.values(obj)) {
    walkForProducts(v, out, depth + 1, budget);
    if (budget.n <= 0) return;
  }
}

function extractNextData(html: string): unknown | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Buscas diretas em lojas que respondem server-side                   */
/* ------------------------------------------------------------------ */

function slugifyQuery(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const NOISE_TOKENS = new Set([
  "mercado", "livre", "amazon", "magazine", "luiza", "magalu", "kabum", "shopee",
  "casas", "bahia", "americanas", "pichau", "carrefour", "shein", "extra", "ponto",
  "frio", "fast", "shop", "submarino", "biscuit", "menor", "preco", "comprar",
  "online", "brasil", "site", "oferta", "barato",
]);

/** Termo enxuto para busca direta no catálogo da loja (sem nomes de lojas). */
function storeQuery(q: string): string {
  const tokens = q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !NOISE_TOKENS.has(t))
    .slice(0, 7);
  return tokens.length ? tokens.join("-") : slugifyQuery(q).split("-").slice(0, 4).join("-");
}

async function searchKabum(query: string): Promise<Candidate[]> {
  const html = await fetchText(`https://www.kabum.com.br/busca/${encodeURIComponent(storeQuery(query))}`);
  if (!html) return [];
  const data = extractNextData(html);
  if (!data) return [];
  const found: WalkedProduct[] = [];
  walkForProducts(data, found, 0, { n: 4000 });
  const out: Candidate[] = [];
  for (const p of found) {
    const url = p.code
      ? `https://www.kabum.com.br/produto/${p.code}`
      : p.url?.startsWith("http")
        ? p.url
        : p.url
          ? `https://www.kabum.com.br${p.url}`
          : null;
    if (!url || !url.includes("kabum.com.br") || url.includes("images.") || /\/fotos?\//.test(url)) continue;
    out.push({
      id: 0,
      site: "KaBuM!",
      url,
      name: p.name,
      brand: p.brand,
      price: p.price,
      confirmed: true,
      origin: "pagina",
      snippet: "",
    });
    if (out.length >= 8) break;
  }
  return out;
}

async function searchMagalu(query: string): Promise<Candidate[]> {
  const html = await fetchText(
    `https://www.magazineluiza.com.br/busca/${encodeURIComponent(storeQuery(query))}/`
  );
  if (!html) return [];
  const data = extractNextData(html);
  if (!data) return [];
  const found: WalkedProduct[] = [];
  walkForProducts(data, found, 0, { n: 6000 });
  const out: Candidate[] = [];
  for (const p of found) {
    let url: string | null = null;
    if (p.url?.startsWith("http")) url = p.url;
    else if (p.url && !p.url.startsWith("/busca")) url = `https://www.magazineluiza.com.br/${p.url.replace(/^\//, "")}/p`;
    if (!url || !url.includes("magazineluiza.com.br") || url.includes("/busca/")) continue;
    out.push({
      id: 0,
      site: "Magazine Luiza",
      url,
      name: p.name,
      brand: p.brand,
      price: p.price,
      confirmed: true,
      origin: "pagina",
      snippet: "",
    });
    if (out.length >= 8) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Comparadores (Zoom / Buscapé): ofertas reais de Amazon, ML, Magalu… */
/* ------------------------------------------------------------------ */

interface ZoomHit {
  name?: unknown;
  price?: unknown;
  seoUrl?: unknown;
  categorySeoUrl?: unknown;
  bestOffer?: { merchantName?: unknown } | null;
}

async function searchComparator(query: string, base: "zoom.com.br" | "buscape.com.br"): Promise<Candidate[]> {
  const html = await fetchText(`https://www.${base}/search?q=${encodeURIComponent(query)}`, 18000);
  if (!html) return [];
  const data = extractNextData(html) as
    | { props?: { initialReduxState?: { hits?: { hits?: ZoomHit[] } } } }
    | null;
  const hits = data?.props?.initialReduxState?.hits?.hits;
  if (!Array.isArray(hits)) return [];

  const out: Candidate[] = [];
  for (const hit of hits) {
    const name = typeof hit?.name === "string" ? hit.name.trim() : "";
    const price = typeof hit?.price === "number" ? hit.price : parseBRL(String(hit?.price ?? ""));
    const seo = typeof hit?.seoUrl === "string" ? hit.seoUrl : "";
    const cat = typeof hit?.categorySeoUrl === "string" ? hit.categorySeoUrl : "";
    const merchant = typeof hit?.bestOffer?.merchantName === "string" ? hit.bestOffer.merchantName.trim() : "";
    if (!name || price == null || price <= 0 || !seo || !cat || !merchant) continue;
    out.push({
      id: 0,
      site: merchant,
      url: `https://www.${base}/${cat}/${seo}`,
      name,
      brand: null,
      price,
      confirmed: true,
      origin: "comparador",
      snippet: `Oferta de ${merchant} listada no comparador ${base === "zoom.com.br" ? "Zoom" : "Buscapé"}.`,
    });
    if (out.length >= 16) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Mercado Livre: API oficial (requer MERCADO_LIVRE_CLIENT_ID/SECRET)   */
/* ------------------------------------------------------------------ */

let mlTokenCache: { token: string; expiresAt: number } | null = null;

export function mercadoLivreConfigured(): boolean {
  return Boolean(process.env.MERCADO_LIVRE_CLIENT_ID && process.env.MERCADO_LIVRE_CLIENT_SECRET);
}

async function mercadoLivreToken(): Promise<string | null> {
  const clientId = process.env.MERCADO_LIVRE_CLIENT_ID;
  const clientSecret = process.env.MERCADO_LIVRE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (mlTokenCache && Date.now() < mlTokenCache.expiresAt - 60_000) return mlTokenCache.token;
  try {
    const res = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    mlTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 21600) * 1000,
    };
    return mlTokenCache.token;
  } catch {
    return null;
  }
}

interface MlItem {
  title?: unknown;
  price?: unknown;
  permalink?: unknown;
  condition?: unknown;
  thumbnail?: unknown;
  official_store_name?: unknown;
  seller?: { nickname?: unknown } | null;
}

async function searchMercadoLivre(query: string): Promise<Candidate[]> {
  const token = await mercadoLivreToken();
  if (!token) return [];
  try {
    const url = `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(query)}&limit=12`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: MlItem[] };
    const out: Candidate[] = [];
    for (const item of data.results ?? []) {
      if (item.condition !== "new" && item.condition != null) continue; // edital: somente novo
      const name = typeof item.title === "string" ? item.title.trim() : "";
      const price = typeof item.price === "number" ? item.price : null;
      const url2 = typeof item.permalink === "string" ? item.permalink : "";
      if (!name || price == null || price <= 0 || !url2.startsWith("http")) continue;
      const store =
        typeof item.official_store_name === "string" && item.official_store_name
          ? item.official_store_name
          : null;
      out.push({
        id: 0,
        site: "Mercado Livre",
        url: url2,
        name,
        brand: store,
        price,
        confirmed: true,
        origin: "pagina",
        snippet: store
          ? `Loja oficial ${store} no Mercado Livre (API oficial).`
          : "Anúncio do Mercado Livre (API oficial).",
      });
      if (out.length >= 8) break;
    }
    return out;
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Bing Shopping: ofertas por vendedor (Mercado Livre, Amazon…)        */
/* ------------------------------------------------------------------ */

const SELLER_TO_SITE: [RegExp, string][] = [
  [/mercado\s*livre/i, "Mercado Livre"],
  [/amazon/i, "Amazon"],
  [/magazine\s*lu?iza|magalu/i, "Magazine Luiza"],
  [/casas?\s*bahia/i, "Casas Bahia"],
  [/kabum/i, "KaBuM!"],
  [/americanas/i, "Americanas"],
  [/shopee/i, "Shopee"],
  [/carrefour/i, "Carrefour"],
  [/ponto\s*frio/i, "Ponto Frio"],
  [/fast\s*shop/i, "Fast Shop"],
  [/submarino/i, "Submarino"],
  [/pichau/i, "Pichau"],
  [/kalunga/i, "Kalunga"],
  [/webcontinental/i, "Webcontinental"],
  [/mobly/i, "Mobly"],
  [/leroy/i, "Leroy Merlin"],
  [/madeira/i, "MadeiraMadeira"],
];

function normalizeSeller(raw: string): string | null {
  const hit = SELLER_TO_SITE.find(([re]) => re.test(raw));
  return hit ? hit[1] : null;
}

function siteToHost(siteName: string): string | null {
  const hit = TRUSTED_SITES.find((s) => s.name === siteName);
  return hit ? hit.host : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .trim();
}

export interface ShoppingCard {
  site: string;
  name: string;
  price: number;
  directUrl: string | null;
  entityUrl: string | null;
}

/** URL pública de busca do produto na loja (fallback honesto quando o anúncio direto é inacessível). */
export function storeSearchUrl(siteName: string, productName: string): string {
  const q = productName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  const qh = encodeURIComponent(productName.slice(0, 90));
  const name = siteName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (name.includes("mercado") || name.includes("livre")) return `https://lista.mercadolivre.com.br/${q}`;
  if (name.includes("amazon")) return `https://www.amazon.com.br/s?k=${qh}`;
  if (name.includes("magazine")) return `https://www.magazineluiza.com.br/busca/${q}/`;
  if (name.includes("americanas")) return `https://www.americanas.com.br/busca/${q}`;
  if (name.includes("shopee")) return `https://shopee.com.br/search?keyword=${qh}`;
  if (name.includes("kabum")) return `https://www.kabum.com.br/busca/${q}`;
  if (name.includes("carrefour")) return `https://www.carrefour.com.br/busca/${q}`;
  if (name.includes("bahia")) return `https://www.casasbahia.com.br/busca/${q}`;
  if (name.includes("kalunga")) return `https://www.kalunga.com.br/busca/${q}/1`;
  if (name.includes("webcontinental")) return `https://www.webcontinental.com.br/busca/${qh}`;
  if (name.includes("mobly")) return `https://www.mobly.com.br/busca?q=${qh}`;
  if (name.includes("pichau")) return `https://www.pichau.com.br/search?q=${qh}`;
  if (name.includes("leroy")) return `https://www.leroymerlin.com.br/search?term=${qh}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(productName + " " + siteName)}`;
}

function extractMerchantUrl(html: string, host: string): string | null {
  const candidates: string[] = [];
  // 1) links diretos no HTML
  for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    candidates.push(m[1].replace(/&amp;/g, "&"));
  }
  // 2) links codificados do Bing (ck/a → base64 → contém alink/link?url=<loja>)
  for (const m of html.matchAll(/[?&]u=([a-zA-Z0-9_\-]{16,})/g)) {
    let e = m[1];
    if (e.startsWith("a1")) e = e.slice(2);
    try {
      let u = Buffer.from(e.replace(/-/g, "+").replace(/_/g, "/") + "==", "base64").toString("utf-8");
      // bing.com/alink/link?url=<loja codificada>
      const inner = u.match(/[?&]url=([^&]+)/);
      if (inner) {
        try {
          const dec = decodeURIComponent(inner[1]);
          if (dec.startsWith("http")) u = dec;
        } catch {
          /* mantém u */
        }
      }
      if (u.startsWith("http")) candidates.push(u);
    } catch {
      /* ignora */
    }
  }
  for (const u of candidates) {
    try {
      const h = new URL(u).hostname.toLowerCase();
      if (!h.includes(host)) continue;
      return u;
    } catch {
      continue;
    }
  }
  return null;
}

async function collectShoppingCards(query: string): Promise<ShoppingCard[]> {
  const html = await fetchText(
    `https://www.bing.com/shop?q=${encodeURIComponent(query)}&cc=br&setlang=pt-BR`,
    18000
  );
  if (!html) return [];

  const cards: ShoppingCard[] = [];
  const blocks = html.split('<li class="br-item"').slice(1);
  for (const block of blocks.slice(0, 16)) {
    const altMatch = block.match(/<img[^>]+alt="([^"]{8,240})"/);
    const priceMatch = block.match(/pd-price[^>]*>\s*(R\$\s?[0-9][0-9.,]*)/);
    const sellerMatch =
      block.match(/br-sellersCite[^>]*>([^<]{2,60})</) ??
      block.match(/br-sellerImage[\s\S]{0,340}?title="([^"]{2,60})"/) ??
      block.match(/br-sellerBlock[\s\S]{0,420}?title="([^"]{2,60})"/);
    if (!altMatch || !priceMatch || !sellerMatch) continue;
    const site = normalizeSeller(sellerMatch[1]);
    if (!site) continue;
    const price = parseBRL(priceMatch[1]);
    if (price == null || price <= 0) continue;

    const host = siteToHost(site);
    const directUrl = host ? extractMerchantUrl(block, host) : null;
    const entityMatch = block.match(/data-url="([^"]+)"/);
    const entityUrl =
      !directUrl && entityMatch
        ? `https://www.bing.com${entityMatch[1].replace(/&amp;/g, "&")}`
        : null;
    cards.push({ site, name: decodeEntities(altMatch[1]), price, directUrl, entityUrl });
  }
  return cards;
}

export interface ShoppingHarvest {
  /** ofertas com link direto confirmado do anúncio */
  candidates: Candidate[];
  /** ofertas onde o link direto não foi possível — usar fallback de busca na loja */
  tiles: ShoppingCard[];
}

/** buscadores com restrição a lojas que são prioridade para os resultados */
const PRIORITY_SELLERS = ["mercado livre", "amazon", "shopee", "magazine luiza"];

export async function searchBingShopping(queries: string[], budgetMs = 35000): Promise<ShoppingHarvest> {
  const t0 = Date.now();
  const remaining = () => budgetMs - (Date.now() - t0);
  const trimmed = queries.map((q) => q.trim()).filter(Boolean).slice(0, 3);
  // ML/Amazon ranqueiam melhor com termos amplos — inclui uma versão raiz (primeiras 2-3 palavras)
  const broad = trimmed
    .map((q) => q.split(/\s+/).slice(0, 3).join(" "))
    .filter((q) => q.length > 4 && !trimmed.includes(q));
  const all = [...trimmed, ...broad].slice(0, 4);
  const runs = await mapPool(all, 4, async (q) => collectShoppingCards(q).catch(() => []));

  // mescla com dedupe e equilíbrio entre lojas (máx. 4 cada)
  const merged: ShoppingCard[] = [];
  const seen = new Set<string>();
  const siteCount = new Map<string, number>();
  for (const run of runs) {
    for (const c of run) {
      const k = `${c.site}|${normalizeName(c.name).slice(0, 50)}|${c.price.toFixed(2)}`;
      if (seen.has(k)) continue;
      const cnt = siteCount.get(c.site.toLowerCase()) ?? 0;
      if (cnt >= 4) continue;
      seen.add(k);
      siteCount.set(c.site.toLowerCase(), cnt + 1);
      merged.push(c);
    }
  }

  // resolve o link direto do anúncio (prioridade para ML/Amazon/Shopee/Magalu, limitado pelo tempo restante)
  const resolveBudget = Math.min(8000, Math.max(3500, remaining() * 0.5));
  const pending = merged
    .filter((c) => !c.directUrl && c.entityUrl)
    .sort((a, b) => {
      const pa = PRIORITY_SELLERS.indexOf(
        PRIORITY_SELLERS.find((s) => a.site.toLowerCase().includes(s)) ?? "zzz"
      );
      const pb = PRIORITY_SELLERS.indexOf(
        PRIORITY_SELLERS.find((s) => b.site.toLowerCase().includes(s)) ?? "zzz"
      );
      return pa - pb;
    })
    .slice(0, remaining() > 9000 ? 6 : 3);
  await mapPool(pending, 3, async (c) => {
    const host = siteToHost(c.site);
    if (!host || !c.entityUrl) return;
    try {
      const page = await fetchText(c.entityUrl, resolveBudget);
      if (page) c.directUrl = extractMerchantUrl(page, host);
    } catch {
      /* sem link direto — cai no fallback */
    }
  });

  const candidates: Candidate[] = merged
    .filter((c) => c.directUrl)
    .map((c) => ({
      id: 0,
      site: c.site,
      url: c.directUrl as string,
      name: c.name,
      brand: null,
      price: c.price,
      confirmed: true,
      origin: "busca" as const,
      snippet: "Oferta indexada pelo Bing Shopping.",
    }));
  const tiles = merged
    .filter((c) => !c.directUrl)
    .map((c) => ({ ...c, entityUrl: null }));
  return { candidates, tiles };
}

/* ------------------------------------------------------------------ */
/* Americanas (API pública de catálogo VTEX)                           */
/* ------------------------------------------------------------------ */

interface VtexProduct {
  productName?: unknown;
  brand?: unknown;
  link?: unknown;
  linkText?: unknown;
  items?: {
    sellers?: { commertialOffer?: { Price?: unknown; ListPrice?: unknown } | null }[];
  }[];
}

async function searchAmericanas(query: string): Promise<Candidate[]> {
  const url = `https://www.americanas.com.br/api/catalog_system/pub/products/search?ft=${encodeURIComponent(
    query
  )}&_from=0&_to=11`;
  const raw = await fetchText(url, 15000);
  if (!raw) return [];
  let list: VtexProduct[];
  try {
    const parsed = JSON.parse(raw);
    list = Array.isArray(parsed) ? (parsed as VtexProduct[]) : [];
  } catch {
    return [];
  }

  const out: Candidate[] = [];
  for (const p of list) {
    const name = typeof p.productName === "string" ? p.productName.trim() : "";
    let price: number | null = null;
    for (const item of p.items ?? []) {
      for (const seller of item.sellers ?? []) {
        const raw2 = seller?.commertialOffer?.Price;
        const v = typeof raw2 === "number" ? raw2 : parseBRL(String(raw2 ?? ""));
        if (v != null && v > 0 && (price == null || v < price)) price = v;
      }
    }
    const link =
      typeof p.link === "string" && p.link.startsWith("http")
        ? p.link
        : typeof p.linkText === "string" && p.linkText
          ? `https://www.americanas.com.br/produto/${p.linkText}`
          : null;
    if (!name || price == null || !link) continue;
    const brandRaw = typeof p.brand === "string" ? p.brand.trim() : "";
    out.push({
      id: 0,
      site: "Americanas",
      url: link,
      name,
      brand: brandRaw && !/não\s*dispon/i.test(brandRaw) ? brandRaw : null,
      price,
      confirmed: true,
      origin: "pagina",
      snippet: "",
    });
    if (out.length >= 8) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Preço na página do produto (JSON-LD / meta)                         */
/* ------------------------------------------------------------------ */

interface PageProduct {
  price: number | null;
  name: string | null;
  brand: string | null;
}

function productFromJsonLdNode(node: unknown, acc: PageProduct[]): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    node.forEach((n) => productFromJsonLdNode(n, acc));
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj["@graph"])) productFromJsonLdNode(obj["@graph"], acc);

  const type = obj["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === "string" && /product/i.test(t))) {
    const offers = obj.offers;
    const offerArr = Array.isArray(offers) ? offers : offers ? [offers] : [];
    for (const off of offerArr) {
      if (!off || typeof off !== "object") continue;
      const o = off as Record<string, unknown>;
      const currency = String(o.priceCurrency ?? "").toUpperCase();
      if (currency && currency !== "BRL") continue;
      const raw = o.price ?? o.lowPrice;
      const price =
        typeof raw === "number" ? raw : typeof raw === "string" ? parseBRL(raw) : null;
      if (price != null && price > 0.5) {
        const brandRaw = obj.brand;
        const brand =
          typeof brandRaw === "string"
            ? brandRaw
            : brandRaw && typeof brandRaw === "object"
              ? ((brandRaw as Record<string, unknown>).name as string | undefined) ?? null
              : null;
        acc.push({ price, name: typeof obj.name === "string" ? obj.name : null, brand });
        return;
      }
    }
  }
}

export function extractProductFromPage(html: string): PageProduct {
  const result: PageProduct = { price: null, name: null, brand: null };
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  const acc: PageProduct[] = [];
  for (const m of blocks.slice(0, 6)) {
    try {
      const clean = m[1].replace(/[\x00-\x1f]/g, " ").trim();
      productFromJsonLdNode(JSON.parse(clean), acc);
    } catch {
      /* json-ld inválido */
    }
    if (acc.length) break;
  }
  if (acc.length) {
    result.price = acc[0].price;
    result.name = acc[0].name;
    result.brand = acc[0].brand;
    return result;
  }

  const meta = html.match(
    /<meta[^>]+(?:property|name)="(?:product:price:amount|og:price:amount)"[^>]+content="([^"]+)"/i
  ) ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="(?:product:price:amount|og:price:amount)"/i);
  if (meta?.[1]) {
    const p = Number(meta[1]) || parseBRL(meta[1]);
    if (p && p > 0.5) result.price = p;
  }
  if (result.price == null) {
    const loose = html.match(/"(?:price|bestPrice)"\s*:\s*"?(\d{1,7}\.\d{2})"?/);
    if (loose?.[1]) {
      const p = Number(loose[1]);
      if (p > 0.5) result.price = p;
    }
  }
  const ogName = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
  if (ogName?.[1]) result.name = ogName[1].trim();
  return result;
}

/* ------------------------------------------------------------------ */
/* Coleta principal                                                    */
/* ------------------------------------------------------------------ */

function isTrustedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return TRUSTED_SITES.some((s) => host.includes(s.host));
  } catch {
    return false;
  }
}

function looksLikeProductPage(url: string): boolean {
  return /\/(produto|product|p|dp|item|pdp|oferta|goods)\b|\/produto\/\d+|[?&](id|sku|code)=/i.test(url);
}

const PRICE_IN_SNIPPET = /R\$\s?([0-9]{1,3}(?:\.[0-9]{3})*,\d{2}|[0-9]{2,7},\d{2})/;

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (idx < items.length) {
        const current = items[idx++];
        out.push(await fn(current));
      }
    })
  );
  return out;
}

export interface GatherResult {
  candidates: Candidate[];
  sources: SourceRef[];
  executedQueries: string[];
}

/** Limite de ofertas por loja, para a lista não ficar dominada por um só site. */
export const PER_SITE_DEFAULT = 3;
export const MAX_CANDIDATES_DEFAULT = 40;
const PER_SITE_CAP = PER_SITE_DEFAULT;
const MAX_CANDIDATES = MAX_CANDIDATES_DEFAULT;

/** Edital exige produto novo: descarta usado/recondicionado/mostruário. */
const USED_RE =
  /\b(usad[oa]s?|seminov[oa]s?|semi-nov[oa]s?|recondicionad[oa]s?|refurbish(ed)?|remanufaturad[oa]s?|mostru[áa]rio|vitrine|de\s*vitrine|open\s*box|avariad[oa]|com\s*defeito|para\s*pe[çc]as)\b/i;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface GatherOptions {
  /** mais ofertas por loja — usado quando o filtro de conformidade descarta muitas */
  perSiteCap?: number;
  /** limite total de candidatas avaliadas */
  maxCandidates?: number;
}

export async function gatherCandidates(
  queries: string[],
  budgetMs = 62000,
  options: GatherOptions = {}
): Promise<GatherResult> {
  const perSiteCap = options.perSiteCap ?? PER_SITE_CAP;
  const maxCandidates = options.maxCandidates ?? MAX_CANDIDATES;
  const t0 = Date.now();
  const remaining = () => budgetMs - (Date.now() - t0);
  const trimmed = queries.map((q) => q.trim()).filter(Boolean).slice(0, 6);
  const executedQueries: string[] = [];
  const sources: SourceRef[] = [];
  const seenUrl = new Set<string>();
  const seenProduct = new Set<string>();
  const pool: Candidate[] = [];
  const addCandidate = (c: Candidate) => {
    const key = c.url.split("?")[0].replace(/#.*$/, "");
    if (seenUrl.has(key) || pool.length >= 120) return;
    if (USED_RE.test(c.name)) return; // edital exige produto novo
    // evita o mesmo produto repetido (mesmo nome + mesmo preço, possivelmente em fontes diferentes)
    const pKey = `${normalizeName(c.name).slice(0, 60)}|${c.price.toFixed(2)}`;
    if (seenProduct.has(pKey)) return;
    seenProduct.add(pKey);
    seenUrl.add(key);
    pool.push(c);
  };

  /* termo enxuto para os catálogos/comparadores (sem nomes de loja) */
  const clean = Array.from(
    new Set(trimmed.map((q) => storeQuery(q).replace(/-/g, " ")).filter((q) => q.length > 3))
  ).slice(0, 3);
  const primary = clean[0] ?? trimmed[0] ?? "";

  /* ---- todas as fontes em paralelo ---- */
  const [bingRuns, comparatorRuns, storeRuns, shoppingRuns] = await Promise.all([
    // 1) buscadores → links diretos reais das lojas
    mapPool(trimmed, 3, async (q) => {
      executedQueries.push(q);
      return bingSearch(q, 10);
    }),
    // 2) comparadores → ofertas de Amazon, Mercado Livre, Magalu, Casas Bahia, Fast Shop…
    mapPool(clean.slice(0, 3), 3, async (q) => {
      const [zoom, buscape] = await Promise.all([
        searchComparator(q, "zoom.com.br").catch(() => []),
        searchComparator(q, "buscape.com.br").catch(() => []),
      ]);
      return [...zoom, ...buscape];
    }),
    // 3) catálogos que respondem a servidor (KaBuM!, Americanas, Magalu, Mercado Livre via API oficial)
    mapPool(clean.slice(0, 2), 3, async (q) => {
      const [kb, am, mg, ml] = await Promise.all([
        searchKabum(q).catch(() => []),
        searchAmericanas(q).catch(() => []),
        searchMagalu(q).catch(() => []),
        searchMercadoLivre(q).catch(() => []),
      ]);
      return [...kb, ...am, ...mg, ...ml];
    }),
    // 4) Bing Shopping → ofertas por vendedor (Mercado Livre, Amazon, Shopee…)
    searchBingShopping(clean.slice(0, 3), Math.max(35000, budgetMs * 0.55)).catch(
      () => ({ candidates: [], tiles: [] }) as ShoppingHarvest
    ),
  ]);

  const bingResults = bingRuns.flat();
  for (const r of bingResults) sources.push({ uri: r.url, title: r.title });
  const trusted = bingResults.filter((r) => isTrustedHost(r.url) && looksLikeProductPage(r.url));

  /* 1a) tenta confirmar preço abrindo a página do produto (se sobrar tempo) */
  const pageBudget = Math.min(9000, Math.max(4000, remaining() * 0.25));
  const pagesToFetch = remaining() > budgetMs * 0.3 ? trusted.slice(0, 12) : [];
  const fetched = await mapPool(pagesToFetch, 5, async (r) => {
    const html = await fetchText(r.url, pageBudget);
    return { r, page: html ? extractProductFromPage(html) : null };
  });
  for (const { r, page } of fetched) {
    const { site } = siteFromUrl(r.url);
    if (page?.price != null) {
      addCandidate({
        id: 0,
        site,
        url: r.url,
        name: page.name ?? r.title,
        brand: page.brand,
        price: page.price,
        confirmed: true,
        origin: "pagina",
        snippet: r.snippet,
      });
      continue;
    }
    const m = r.snippet.match(PRICE_IN_SNIPPET);
    const snippetPrice = m?.[1] ? parseBRL(m[1]) : null;
    if (snippetPrice != null) {
      addCandidate({
        id: 0,
        site,
        url: r.url,
        name: r.title,
        brand: null,
        price: snippetPrice,
        confirmed: false,
        origin: "busca",
        snippet: r.snippet,
      });
    }
  }

  /* 1b) preço no snippet quando a página não abriu (loja com anti-robô) */
  for (const r of trusted) {
    const key = r.url.split("?")[0].replace(/#.*$/, "");
    if (seenUrl.has(key)) continue;
    const m = r.snippet.match(PRICE_IN_SNIPPET);
    const snippetPrice = m?.[1] ? parseBRL(m[1]) : null;
    if (snippetPrice == null) continue;
    addCandidate({
      id: 0,
      site: siteFromUrl(r.url).site,
      url: r.url,
      name: r.title,
      brand: null,
      price: snippetPrice,
      confirmed: false,
      origin: "busca",
      snippet: r.snippet,
    });
  }

  /* Bing Shopping: ofertas que abrangem ML, Amazon, Shopee… */
  for (const c of shoppingRuns.candidates) addCandidate(c);
  for (const t of shoppingRuns.tiles) {
    if (!siteToHost(t.site)) continue;
    addCandidate({
      id: 0,
      site: t.site,
      url: storeSearchUrl(t.site, t.name),
      name: t.name,
      brand: null,
      price: t.price,
      confirmed: true,
      origin: "busca_loja",
      snippet: "Preço visto no Bing Shopping — o link abre a busca direta da loja.",
    });
  }

  for (const c of storeRuns.flat()) addCandidate(c);
  for (const c of comparatorRuns.flat()) addCandidate(c);

  if (primary) {
    sources.push({
      uri: `https://www.zoom.com.br/search?q=${encodeURIComponent(primary)}`,
      title: `Zoom — comparador de ofertas: ${primary}`,
    });
    sources.push({
      uri: `https://www.buscape.com.br/search?q=${encodeURIComponent(primary)}`,
      title: `Buscapé — comparador de ofertas: ${primary}`,
    });
  }

  /* ---- distribuição: no máx. PER_SITE_CAP por loja, do mais barato ao mais caro ---- */
  const bySite = new Map<string, Candidate[]>();
  for (const c of pool.sort((a, b) => a.price - b.price)) {
    const key = c.site.toLowerCase();
    const arr = bySite.get(key) ?? [];
    if (arr.length < PER_SITE_CAP) {
      arr.push(c);
      bySite.set(key, arr);
    }
  }
  // intercala lojas (round-robin) para garantir variedade no topo da lista
  const lists = [...bySite.values()].sort((a, b) => a[0].price - b[0].price);
  const balanced: Candidate[] = [];
  for (let round = 0; round < PER_SITE_CAP; round++) {
    for (const list of lists) {
      if (list[round]) balanced.push(list[round]);
    }
  }

  const candidates = balanced.slice(0, MAX_CANDIDATES);
  candidates.forEach((c, i) => (c.id = i + 1));
  return {
    candidates,
    sources: Array.from(new Map(sources.map((s) => [s.uri, s])).values()).slice(0, 16),
    executedQueries,
  };
}
