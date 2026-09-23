/**
 * Proxy CORS do LicitaPreço — versão estática (GitHub Pages)
 * -----------------------------------------------------------
 * A página publicada no Pages é 100% estática: sem servidor, o navegador não consegue
 * ler magazineluiza.com.br, kabum.com.br, bing.com… (política CORS). Este Worker é o
 * "servidor" mínimo que resolve isso — 1 arquivo, camada grátis do Cloudflare
 * (100.000 requisições/dia), sem banco e sem custo.
 *
 * Uso pelo app:  https://<nome>.<subdominio>.workers.dev/?url=<url codificada>
 *
 * Variáveis de ambiente (opcionais, no painel do Worker → Settings → Variables):
 *   PROXY_TOKEN   se definido, exige ?t=<token> em cada requisição (evita proxy aberto)
 *   ALLOWED_HOSTS sufixos extras separados por vírgula (ex.: "lojaqualquer.com.br")
 */

const ALLOWED_HOST_SUFFIXES = [
  // buscadores usados para achar os anúncios
  "bing.com",
  "duckduckgo.com",
  // varejo
  "magazineluiza.com.br",
  "magalu.com.br",
  "kabum.com.br",
  "americanas.com.br",
  "casasbahia.com.br",
  "carrefour.com.br",
  "extra.com.br",
  "pontoassistencia.com.br",
  "amazon.com.br",
  "mercadolivre.com.br",
  "mercadolibre.com",
  "shopee.com.br",
  "aliexpress.com",
  "dell.com",
  "lenovo.com",
  "hp.com",
  // comparadores / cupons
  "zoom.com.br",
  "buscape.com.br",
  "pelando.com.br",
  "pprofissionais.com.br",
];

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB por resposta — páginas de loja são grandes
const TIMEOUT_MS = 20000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

/** SSRF básico: nada de endereços internos/locais passando por aqui. */
function isPrivateHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(127\.|10\.|0\.)/.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.startsWith("[")) return true; // IPv6 literal
  return false;
}

function allowedHost(hostname, env) {
  const extra = (env.ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const list = ALLOWED_HOST_SUFFIXES.concat(extra);
  const h = hostname.toLowerCase().replace(/^www\./, "");
  return list.some((suffix) => h === suffix || h.endsWith(`.${suffix}`) || h.endsWith(suffix));
}

const worker = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "GET" && request.method !== "HEAD") return json(405, "use GET");

    const url = new URL(request.url);
    if (env.PROXY_TOKEN && url.searchParams.get("t") !== env.PROXY_TOKEN) {
      return json(401, "token do proxy inválido (PROXY_TOKEN)");
    }

    // aceita ?url=<qualquer-coisa> e também /https://site.com/... (proxy de prefixo)
    const raw = url.searchParams.get("url") || decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    let target;
    try {
      target = new URL(raw);
    } catch {
      return json(400, "falta o parâmetro ?url= (URL absoluta)");
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") return json(400, "só http/https");
    if (isPrivateHost(target.hostname)) return json(403, "host interno não permitido");
    if (!allowedHost(target.hostname, env)) {
      return json(403, `host fora da allowlist: ${target.hostname} (adicione em ALLOWED_HOSTS se precisar)`);
    }

    try {
      const upstream = await fetch(target.toString(), {
        method: request.method === "HEAD" ? "HEAD" : "GET",
        redirect: "follow",
        cf: { cacheTtl: 0 },
        headers: {
          // cabeçalhos de navegador: as lojas bloqueiam requisições "cruas" do worker
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "cross-site",
          "Upgrade-Insecure-Requests": "1",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const body = await upstream.arrayBuffer();
      if (body.byteLength > MAX_BYTES) return json(413, "página maior que 4 MB");

      const headers = new Headers(CORS_HEADERS);
      headers.set("Content-Type", upstream.headers.get("Content-Type") || "text/plain; charset=utf-8");
      headers.set("X-Proxy-Status", String(upstream.status));
      headers.set("X-Proxy-Url", target.hostname);

      return new Response(body, { status: upstream.status, headers });
    } catch (err) {
      const msg = err && err.name === "TimeoutError" ? `timeout de ${TIMEOUT_MS} ms` : String((err && err.message) || err);
      return json(502, `falha ao buscar ${target.hostname}: ${msg}`);
    }
  },
};

export default worker;
