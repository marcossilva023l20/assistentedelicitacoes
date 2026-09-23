/**
 * Proxy + autenticação do LicitaPreço — versão estática (GitHub Pages)
 * ---------------------------------------------------------------------
 * A página publicada no Pages é estática: sem servidor, o navegador não consegue ler
 * magazineluiza.com.br / kabum.com.br / bing.com (CORS) e qualquer chave colocada no HTML é
 * pública. Este Worker resolve as duas coisas e é 100% camada grátis do Cloudflare
 * (100.000 requisições/dia), sem banco e sem custo.
 *
 * Rotas
 *   GET  /?url=<url codificada>   → repassa a página pública da loja (usa o navegador logado)
 *   POST /login                   → { email, password } → { token, exp, email }
 *   GET  /verify                  → confirma o token guardado no navegador → { email, exp }
 *   POST /gemini                  → { model, contents, config } → { text, model }
 *                                   (a chave do Google NUNCA sai daqui nem vai para o HTML)
 *
 * Variáveis (Settings → Variables & Secrets)
 *   GEMINI_API_KEY  obrigatório para /gemini
 *   AUTH_SECRET     string aleatória usada para assinar o token de sessão (HMAC-SHA256)
 *   USERS           "email:salt:sha256(salt+senha)" separados por vírgula
 *                   → gere cada linha com: node .github/scripts/hash-password.mjs email@x.gov.br
 *   SESSION_HOURS   validade do token (padrão 336 = 14 dias)
 *   PROXY_TOKEN     (opcional, modo sem login) exige ?t= em tudo
 *   ALLOWED_HOSTS   (opcional) sufixos extras separados por vírgula
 *
 * Sem USERS nem AUTH_SECRET o Worker funciona só como proxy (como era antes) e a tela de
 * login do site entra em modo local. Com eles, o login é verificado aqui e a chave fica fora
 * do código público — que é o que de fato protege a sua cota.
 *
 * No site (index.html), preencha ⚙ → "Servidor" com a URL raiz do Worker, ex.:
 *   https://meu-proxy.workers.dev/        (com a barra final; pode colar também via #servidor=URL)
 * A partir daí: login verificado aqui, chamada de IA feita aqui e varredura das lojas aqui.
 * Aceita ainda ?t=<token> no lugar do header Authorization, para links abertos no navegador.
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
];

const MAX_PAGE_BYTES = 4 * 1024 * 1024; // páginas de loja são grandes
const PAGE_TIMEOUT_MS = 20000;
const GEMINI_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-3-flash-preview"];
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
};

const enc = new TextEncoder();

/* ------------------------------------------------------------------ */
/* utilidades                                                          */
/* ------------------------------------------------------------------ */

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text) {
  const pad = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** comparação em tempo constante (não vaza informação por timing) */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseUsers(raw) {
  return (raw || "")
    .split(/[,;\n]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [email, salt, hash] = line.split(":").map((x) => (x || "").trim());
      return email && salt && hash ? { email: email.toLowerCase(), salt, hash: hash.toLowerCase() } : null;
    })
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* sessão: token = base64url(payload JSON) + "." + base64url(HMAC)     */
/* ------------------------------------------------------------------ */

async function issueToken(email, secret, hours) {
  const payload = { email, exp: Date.now() + hours * 3600_000 };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body))));
  return `${body}.${sig}`;
}

async function readToken(token, secret) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = b64url(
    new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)))
  );
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (typeof payload.email !== "string" || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function bearer(request, url) {
  const h = request.headers.get("Authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return url.searchParams.get("t") || "";
}

/** limite simples de tentativas de login por IP (por isolate, melhor esforço) */
const fails = new Map();
function tooManyFails(ip) {
  const now = Date.now();
  const rec = fails.get(ip);
  if (!rec) return 0;
  if (now - rec.t0 > LOGIN_WINDOW_MS) {
    fails.delete(ip);
    return 0;
  }
  return rec.n;
}
function noteFail(ip) {
  const now = Date.now();
  const rec = fails.get(ip);
  if (!rec || now - rec.t0 > LOGIN_WINDOW_MS) fails.set(ip, { t0: now, n: 1 });
  else rec.n++;
  if (fails.size > 5000) fails.clear();
}

/* ------------------------------------------------------------------ */
/* handlers                                                            */
/* ------------------------------------------------------------------ */

async function handleLogin(request, env) {
  const users = parseUsers(env.USERS);
  if (!users.length) return json(501, { error: "USERS não está configurado no Worker" });
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (tooManyFails(ip) >= LOGIN_MAX_FAILS) {
    return json(429, { error: `muitas tentativas: aguarde ~${Math.ceil(LOGIN_WINDOW_MS / 60000)} min` });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "envie JSON { email, password }" });
  }
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const user = users.find((u) => u.email === email);
  if (!user || password.length < 6) {
    noteFail(ip);
    return json(401, { error: "E-mail ou senha inválidos." });
  }
  if (!safeEqual((await sha256Hex(`${user.salt}:${password}`)).toLowerCase(), user.hash)) {
    noteFail(ip);
    return json(401, { error: "E-mail ou senha inválidos." });
  }
  fails.delete(ip);
  const hours = Number(env.SESSION_HOURS || 336);
  const secret = env.AUTH_SECRET || env.PROXY_TOKEN || "";
  if (!secret) return json(500, { error: "defina AUTH_SECRET no Worker para assinar as sessões" });
  return json(200, { token: await issueToken(email, secret, hours), exp: Date.now() + hours * 3600_000, email });
}

async function handleGemini(request, url, env) {
  const secret = env.AUTH_SECRET || env.PROXY_TOKEN || "";
  if (env.USERS && parseUsers(env.USERS).length) {
    const payload = await readToken(bearer(request, url), secret);
    if (!payload) return json(401, { error: "Sessão expirada — faça login de novo." });
  }
  if (!env.GEMINI_API_KEY) return json(500, { error: "GEMINI_API_KEY não configurada no Worker" });

  let req;
  try {
    req = await request.json();
  } catch {
    return json(400, { error: "envie JSON { model, contents, config }" });
  }
  const contents = Array.isArray(req?.contents) ? req.contents : null;
  if (!contents) return json(400, { error: "contents ausente" });

  const models = [...new Set([req.model, ...GEMINI_MODELS].filter(Boolean))];
  let lastStatus = 0;
  let lastError = "";
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: req.config?.temperature ?? 0.15, maxOutputTokens: req.config?.maxOutputTokens ?? 8192 },
        }),
        signal: AbortSignal.timeout(60000),
      });
      lastStatus = res.status;
      if (!res.ok) {
        lastError = (await res.text()).slice(0, 300);
        if (res.status === 429 || res.status === 404 || res.status === 503) continue;
        return json(502, { error: `Gemini HTTP ${res.status}`, detail: lastError });
      }
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
      if (text) return json(200, { text, model });
      lastError = "resposta sem texto";
    } catch (err) {
      lastError = String(err?.message || err);
    }
  }
  return json(lastStatus === 429 ? 429 : 502, {
    error: lastStatus === 429 ? "Cota do Gemini esgotada agora — tente em alguns minutos." : "IA indisponível",
    detail: lastError,
  });
}

async function handleProxy(request, url, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return json(405, { error: "use GET" });
  const raw = url.searchParams.get("url") || decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  let target;
  try {
    target = new URL(raw);
  } catch {
    return json(400, { error: "falta o parâmetro ?url= (URL absoluta)" });
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return json(400, { error: "só http/https" });
  if (isPrivateHost(target.hostname)) return json(403, { error: "host interno não permitido" });
  if (!allowedHost(target.hostname, env)) {
    return json(403, { error: `host fora da allowlist: ${target.hostname} (adicione em ALLOWED_HOSTS)` });
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      redirect: "follow",
      cf: { cacheTtl: 0 },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_PAGE_BYTES) return json(413, { error: "página maior que 4 MB" });
    const headers = new Headers(CORS_HEADERS);
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "text/plain; charset=utf-8");
    headers.set("X-Proxy-Url", target.hostname);
    return new Response(buf, { status: upstream.status, headers });
  } catch (err) {
    const msg = err?.name === "TimeoutError" ? `timeout de ${PAGE_TIMEOUT_MS} ms` : String(err?.message || err);
    return json(502, { error: `falha ao buscar ${target.hostname}: ${msg}` });
  }
}

/** SSRF básico: nada de endereços internos passando por aqui. */
function isPrivateHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(127\.|10\.|0\.|169\.254\.)/.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.startsWith("[")) return true;
  return false;
}

function allowedHost(hostname, env) {
  const extra = (env.ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const h = hostname.toLowerCase().replace(/^www\./, "");
  return ALLOWED_HOST_SUFFIXES.concat(extra).some((s) => h === s || h.endsWith(`.${s}`) || h.endsWith(s));
}

const worker = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();

    try {
      if (path === "/login" && request.method === "POST") return await handleLogin(request, env);
      if (path === "/verify") {
        const secret = env.AUTH_SECRET || env.PROXY_TOKEN || "";
        const payload = await readToken(bearer(request, url), secret);
        return payload ? json(200, payload) : json(401, { error: "sessão inválida ou expirada" });
      }
      if (path === "/gemini" && request.method === "POST") return await handleGemini(request, url, env);

      // proxy de páginas: com USERS configurado exige sessão válida; sem USERS, mantém o
      // comportamento antigo (PROXY_TOKEN opcional)
      if (env.USERS && parseUsers(env.USERS).length) {
        const secret = env.AUTH_SECRET || env.PROXY_TOKEN || "";
        const payload = await readToken(bearer(request, url), secret);
        if (!payload) return json(401, { error: "faça login para usar a varredura" });
      } else if (env.PROXY_TOKEN && url.searchParams.get("t") !== env.PROXY_TOKEN) {
        return json(401, { error: "token do proxy inválido (PROXY_TOKEN)" });
      }
      return await handleProxy(request, url, env);
    } catch (err) {
      return json(500, { error: `erro no worker: ${String(err?.message || err)}` });
    }
  },
};

export default worker;
