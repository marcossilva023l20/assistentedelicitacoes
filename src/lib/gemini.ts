import "server-only";
import { GoogleGenAI } from "@google/genai";
import {
  gatherCandidates,
  PER_SITE_DEFAULT,
  MAX_CANDIDATES_DEFAULT,
  type Candidate,
  type GatherResult,
} from "@/lib/scraper";
import { siteFromUrl, TRUSTED_SITES } from "@/lib/gemini-sites";

export { siteFromUrl, TRUSTED_SITES };

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export interface AnalyzedOption {
  brand: string;
  name: string;
  price: number;
  url: string;
  site: string;
  compliant: boolean;
  complianceScore: number;
  isSimilar: boolean;
  missing: string[];
  trustedSite: boolean;
  /** origem do preço: página da loja, resultado de busca, busca direta na loja ou comparador */
  priceSource: "pagina" | "busca" | "busca_loja" | "comparador";
}

export interface AnalyzedSearch {
  title: string;
  requirements: string[];
  options: AnalyzedOption[];
  sources: { uri: string; title: string }[];
  searchQueries: string[];
  model: string;
  stats: { min: number | null; max: number | null; avg: number | null };
  appliedFilters: SearchFilterOptions;
}

export class MissingKeyError extends Error {
  constructor() {
    super("GEMINI_API_KEY não configurada");
    this.name = "MissingKeyError";
  }
}

export class QuotaError extends Error {
  constructor(message?: string) {
    super(message ?? "Cota gratuita do Gemini esgotada");
    this.name = "QuotaError";
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades de parsing tolerante                                     */
/* ------------------------------------------------------------------ */

function extractJsonBlock(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return null;
}

function parseJsonLoose<T>(text: string): T | null {
  const block = extractJsonBlock(text);
  if (!block) return null;
  try {
    return JSON.parse(block) as T;
  } catch {
    return null;
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Cliente Gemini (texto puro — sem ferramenta de busca paga)          */
/* ------------------------------------------------------------------ */

const MODEL_PREFERENCE = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.8-flash",
  "gemini-3-flash-preview",
];

function getClient(): { ai: GoogleGenAI; models: string[] } | null {
  const apiKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;
  const preferred = process.env.GEMINI_MODEL;
  const models = [...new Set([preferred, ...MODEL_PREFERENCE].filter(Boolean))] as string[];
  return { ai: new GoogleGenAI({ apiKey }), models };
}

function isRetryable(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? "").toLowerCase();
  const status = (err as { status?: number })?.status ?? (err as { code?: number })?.code;
  return (
    status === 429 ||
    status === 404 ||
    status === 503 ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota") ||
    msg.includes("no longer available") ||
    msg.includes("not_found") ||
    msg.includes("overloaded")
  );
}

export async function geminiText(prompt: string, maxTokens: number): Promise<{ text: string; model: string } | null> {
  const client = getClient();
  if (!client) return null;
  for (const model of client.models) {
    try {
      const res = await client.ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature: 0.2, maxOutputTokens: maxTokens },
      });
      const text = res.text ?? "";
      if (text.trim()) return { text, model };
    } catch (err) {
      if (!isRetryable(err)) throw err;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Etapa 1 — planejamento: requisitos + consultas de busca             */
/* ------------------------------------------------------------------ */

export interface Plan {
  title: string;
  requirements: string[];
  queries: string[];
}

const STOPWORDS = new Set(
  "para com sem das dos uma um de do da em no na e ou por que ano anos meses dias novo nova item unidade conforme deve deverá mínimo mínima máximo incluso inclusa produto entrega brasil nota fiscal garantia polegadas volts voltagem cor preto preta branco branca tipo local prazo".split(
    " "
  )
);

function localPlan(editalText: string): Plan {
  const words = editalText
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .match(/[a-z0-9][a-z0-9.\-/]{2,}/gi) ?? [];
  const freq = new Map<string, number>();
  for (const w of words) {
    const clean = w.toLowerCase().replace(/[.\-/]+$/, "");
    if (clean.length < 3 || STOPWORDS.has(clean)) continue;
    freq.set(clean, (freq.get(clean) ?? 0) + 1);
  }
  const base = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w)
    .join(" ");
  const title = editalText.split(/[,.;\n]/)[0].trim().slice(0, 90) || "Item do edital";
  const requirements = editalText
    .split(/[,;.\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 6)
    .slice(0, 10);
  return {
    title,
    requirements,
    queries: [
      `${base} menor preço`,
      `${base} preço`,
      `${base} mercado livre`,
      `${base} magazine luiza`,
      `${base} kabum`,
      `${base} amazon`,
    ],
  };
}

async function planSearch(
  editalText: string,
  filters?: SearchFilterOptions
): Promise<{ plan: Plan; model: string | null }> {
  const prompt = `Você é especialista em pesquisa de preços para licitações públicas brasileiras.

Analise o ITEM DE EDITAL abaixo e responda SOMENTE com um bloco \`\`\`json\`\`\` (sem texto fora dele) neste formato:
{
  "titulo": "nome curto do item (máx. 60 caracteres)",
  "requisitos": ["requisito obrigatório 1", "requisito 2"],
  "consultas": ["termo de busca 1", "termo 2", "termo 3", "termo 4", "termo 5", "termo 6"]
}

Regras:
- "requisitos": extraia TODOS os requisitos técnicos obrigatórios (máx. 12), curtos e objetivos.
- "consultas": exatamente 6 termos de busca em português, como um comprador digitaria numa loja, curtos (3 a 7 palavras), SEM aspas e sem "site:". As 3 PRIMEIRAS devem ser termos genéricos e amplos do produto (só o essencial: tipo + característica principal, ex.: "impressora laser multifuncional wifi"), pois são usadas nos catálogos das lojas. As 3 últimas podem combinar o produto com lojas brasileiras (mercado livre, amazon, magazine luiza, kabum, shopee, casas bahia, carrefour) e a palavra "preço".
${similarHint(filters?.similarMode ?? "all")}

ITEM DO EDITAL:
"""
${editalText.trim().slice(0, 4000)}
"""`;

  const result = await geminiText(prompt, 4096).catch(() => null);
  if (result) {
    const parsed = parseJsonLoose<{ titulo?: unknown; requisitos?: unknown; consultas?: unknown }>(result.text);
    const requirements = asStringArray(parsed?.requisitos);
    const queries = asStringArray(parsed?.consultas);
    if (requirements.length && queries.length >= 2) {
      return {
        plan: {
          title: (typeof parsed?.titulo === "string" ? parsed.titulo : "").slice(0, 90) || "Item do edital",
          requirements: requirements.slice(0, 12),
          queries: queries.slice(0, 6),
        },
        model: result.model,
      };
    }
  }
  return { plan: localPlan(editalText), model: null };
}

/* ------------------------------------------------------------------ */
/* Filtros aplicados pelo usuário                                       */
/* ------------------------------------------------------------------ */

export interface SearchFilterOptions {
  minScore: number;
  similarMode: "all" | "exact" | "similar";
}

function clampFilters(raw: Partial<SearchFilterOptions> | undefined): SearchFilterOptions {
  const minScore = Math.max(5, Math.min(100, Math.round(Number(raw?.minScore ?? 5)) || 5));
  const mode = raw?.similarMode === "exact" || raw?.similarMode === "similar" ? raw.similarMode : "all";
  return { minScore, similarMode: mode };
}

/** Instruções extras para o planejador conforme o filtro de similares. */
function similarHint(mode: SearchFilterOptions["similarMode"]): string {
  if (mode === "exact") {
    return "IMPORTANTE: o usuário quer SOMENTE o produto exato da marca/modelo citada no edital. Priorize consultas com a marca e o modelo exatos. Não sugira equivalentes de outras marcas.";
  }
  if (mode === "similar") {
    return "IMPORTANTE: o usuário quer Equivalentes/Similares. Priorize consultas com marcas alternativas reconhecidas que cumprem as mesmas especificações técnicas (não a marca exata do edital, se houver).";
  }
  return "Considere tanto o produto exato quanto equivalentes de marcas reconhecidas que cumpram integralmente as especificações.";
}

/* ------------------------------------------------------------------ */
/* Etapa 3 — seleção: conformidade com 100% das especificações         */
/* ------------------------------------------------------------------ */

interface LlmVerdict {
  id: number;
  compliant: boolean;
  complianceScore: number;
  isSimilar: boolean;
  missing: string[];
  brand: string | null;
}

async function llmSelect(
  editalText: string,
  requirements: string[],
  candidates: Candidate[],
  filters?: SearchFilterOptions
): Promise<{ verdicts: LlmVerdict[]; model: string | null }> {
  const list = candidates
    .slice(0, 24)
    .map(
      (c) =>
        `#${c.id} | ${c.site} | ${c.name}${c.brand ? ` | marca: ${c.brand}` : ""} | R$ ${c.price.toFixed(2)}${
          c.snippet ? `\n   trecho: ${c.snippet.slice(0, 220)}` : ""
        }`
    )
    .join("\n");

  const prompt = `Você é avaliador técnico de conformidade para licitações públicas brasileiras.

ITEM DO EDITAL:
"""
${editalText.trim().slice(0, 2500)}
"""

REQUISITOS OBRIGATÓRIOS:
${requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")}

OFERTAS REAIS ENCONTRADAS NA WEB (id | loja | nome | preço):
${list}

Tarefa: avalie CADA oferta contra TODOS os requisitos.
- "atende100": true se o produto cumprir 100% de todos os requisitos técnicos do edital.
- "porcentagem": número inteiro de 5 a 100 indicando a porcentagem estimada de atendimento das especificações do edital (100 = atende integralmente; 80-95 = quase tudo; 50-75 = atende parcialmente; <50 = atende pouco).
- "similar": true se o produto for similar/equivalente (outra marca ou modelo com função equivalente), false se for a marca/modelo exata especificada no edital.
- "faltam": lista de requisitos que faltam ou não foram comprovados.

Responda SOMENTE com um bloco \`\`\`json\`\`\` (sem texto fora dele):
{
  "avaliacoes": [
    {
      "id": 1,
      "atende100": true,
      "porcentagem": 100,
      "similar": false,
      "faltam": [],
      "marca": "Marca inferida do nome ou null"
    }
  ]
}
Inclua TODOS os ids avaliados, ordenados do melhor candidato ao pior.`;

  const result = await geminiText(prompt, 8192).catch(() => null);
  if (!result) return { verdicts: [], model: null };

  const parsed = parseJsonLoose<{ avaliacoes?: unknown }>(result.text);
  const verdicts: LlmVerdict[] = [];
  for (const a of Array.isArray(parsed?.avaliacoes) ? parsed.avaliacoes : []) {
    const o = a as Record<string, unknown>;
    const id = typeof o.id === "number" ? o.id : Number(o.id);
    if (!Number.isFinite(id)) continue;
    const isComp = o.atende100 === true;
    const missing = asStringArray(o.faltam).slice(0, 6);
    
    let rawScore = typeof o.porcentagem === "number" ? o.porcentagem : parseInt(String(o.porcentagem || "0"), 10);
    if (!Number.isFinite(rawScore) || rawScore <= 0) {
      const totalReq = requirements.length || 1;
      rawScore = isComp ? 100 : Math.max(5, Math.round(((totalReq - missing.length) / totalReq) * 100));
    }
    const score = Math.max(5, Math.min(100, Math.round(rawScore)));

    verdicts.push({
      id,
      compliant: isComp || score === 100,
      complianceScore: score,
      isSimilar: o.similar === true,
      missing,
      brand: typeof o.marca === "string" && o.marca !== "null" ? o.marca : null,
    });
  }
  return { verdicts, model: result.model };
}

/* Modo local sem IA: cobertura de palavras dos requisitos no nome/trecho */
function naiveSelect(requirements: string[], candidates: Candidate[]): LlmVerdict[] {
  const reqTokens = requirements.map((r) =>
    Array.from(
      new Set(
        r
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .match(/[a-z0-9]{3,}/gi) ?? []
      )
    ).filter((t) => !STOPWORDS.has(t))
  );
  return candidates.map((c) => {
    const hay = `${c.name} ${c.snippet} ${c.brand ?? ""}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const missing: string[] = [];
    let hits = 0;
    requirements.forEach((req, i) => {
      const toks = reqTokens[i] ?? [];
      if (!toks.length) { hits++; return; }
      const hit = toks.filter((t) => hay.includes(t)).length;
      if (hit / toks.length >= 0.5) {
        hits++;
      } else {
        missing.push(req);
      }
    });
    const total = requirements.length || 1;
    const pct = Math.max(5, Math.min(100, Math.round((hits / total) * 100)));
    return {
      id: c.id,
      compliant: missing.length === 0 && requirements.length > 0,
      complianceScore: pct,
      isSimilar: true,
      missing: missing.slice(0, 6),
      brand: null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Identificação de produto por imagem (visão)                         */
/* ------------------------------------------------------------------ */

async function geminiImage(
  prompt: string,
  dataB64: string,
  mimeType: string,
  maxTokens: number
): Promise<{ text: string; model: string } | null> {
  const client = getClient();
  if (!client) return null;
  for (const model of client.models) {
    try {
      const res = await client.ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }, { inlineData: { data: dataB64, mimeType } }],
          },
        ],
        config: { temperature: 0.15, maxOutputTokens: maxTokens },
      });
      const text = res.text ?? "";
      if (text.trim()) return { text, model };
    } catch (err) {
      const msg = String((err as { message?: string })?.message ?? err ?? "").toLowerCase();
      const status = (err as { status?: number })?.status ?? (err as { code?: number })?.code;
      const retryable =
        status === 429 ||
        status === 404 ||
        status === 503 ||
        msg.includes("resource_exhausted") ||
        msg.includes("quota") ||
        msg.includes("no longer available") ||
        msg.includes("not_found") ||
        msg.includes("overloaded");
      if (!retryable) throw err;
    }
  }
  return null;
}

export interface ImageProductPlan extends Plan {
  description: string;
  brand: string | null;
}

export async function analyzeProductImage(buffer: Buffer, mimeType: string): Promise<ImageProductPlan> {
  if (!getClient()) throw new MissingKeyError();

  const prompt = `Você é especialista em identificação de produtos para pesquisa de preços de licitações públicas brasileiras.

Analise a imagem e identifique o produto exibido. Responda SOMENTE com um bloco \`\`\`json\`\`\` (sem texto fora dele):
{
  "produto": "nome do produto em português, como seria buscado numa loja (máx. 80 caracteres)",
  "marca": "marca identificada ou null",
  "especificacoes": ["atributo relevante 1", "atributo 2"],
  "consultas": ["termo 1", "termo 2", "termo 3", "termo 4", "termo 5", "termo 6"]
}

Regras:
- Identifique marca, modelo e características visíveis (cor, formato, tipo, capacidade, material) usando apenas o que dá para ver.
- "especificacoes": até 10 atributos objetivos e curtos (ex.: "cor preta", "sem fio 2.4GHz", "material inox").
- "consultas": exatamente 6 termos como um comprador digitaria (4 a 8 palavras), sem aspas; 2 genéricas com a palavra "preço", as demais combinadas com lojas brasileiras (mercado livre, amazon, magazine luiza, kabum, shopee, carrefour).
- Se não for claramente um produto de varejo, descreva o objeto mais próximo de um produto comprável.`;

  const result = await geminiImage(prompt, buffer.toString("base64"), mimeType, 4096).catch(() => null);
  if (!result) throw new QuotaError("A cota gratuita da IA esgotou agora — tente de novo em alguns minutos.");

  const parsed = parseJsonLoose<{
    produto?: unknown;
    marca?: unknown;
    especificacoes?: unknown;
    consultas?: unknown;
  }>(result.text);

  const produto = (typeof parsed?.produto === "string" && parsed.produto.trim()) || "";
  const specs = asStringArray(parsed?.especificacoes).slice(0, 10);
  const queries = asStringArray(parsed?.consultas).filter((q) => q.length > 3).slice(0, 6);
  const brand =
    typeof parsed?.marca === "string" && parsed.marca.trim() && parsed.marca !== "null"
      ? parsed.marca.trim()
      : null;

  if (produto.length < 3 || queries.length < 2 || specs.length === 0) {
    throw new Error(
      "Não consegui identificar o produto nesta imagem. Envie uma foto nítida do produto (fundo simples, boa luz)."
    );
  }

  const description =
    `${produto}. Especificações identificadas na imagem: ${specs.join(", ")}.` +
    (brand ? ` Marca: ${brand}.` : "") +
    " Produto novo, com nota fiscal, entrega no Brasil.";

  return {
    title: (brand ? `${produto} ${brand}` : produto).slice(0, 90),
    requirements: brand && !specs.some((s) => s.toLowerCase().includes(brand.toLowerCase()))
      ? [...specs, `marca ${brand}`]
      : specs,
    queries,
    description: description.slice(0, 1200),
    brand,
  };
}

/* ------------------------------------------------------------------ */
/* Pipeline principal                                                  */
/* ------------------------------------------------------------------ */

export async function analyzeEditalItem(
  editalText: string,
  planOverride?: Plan,
  rawFilters?: Partial<SearchFilterOptions>
): Promise<AnalyzedSearch> {
  if (!getClient()) throw new MissingKeyError();
  const filters = clampFilters(rawFilters);

  // filtro rigoroso ⇒ coleta mais ofertas, pois muitas serão descartadas
  const gatherOpts =
    filters.minScore >= 80 || filters.similarMode === "exact"
      ? { perSiteCap: 5, maxCandidates: 60 }
      : { perSiteCap: PER_SITE_DEFAULT, maxCandidates: MAX_CANDIDATES_DEFAULT };

  const planPromise: Promise<{ plan: Plan; model: string | null }> = planOverride
    ? Promise.resolve({ plan: planOverride, model: null })
    : planSearch(editalText, filters);

  // Coleta logo com consultas locais (paralelo ao planejamento da IA) e, se a IA
  // entregar consultas melhores, faz uma segunda coleta incremental com o tempo restante.
  const local = planOverride ? null : localPlan(editalText);
  const gatherLocal = local
    ? gatherCandidates(local.queries, 45000, gatherOpts).catch(() => null)
    : null;

  const planResult = await planPromise;

  let gathered: GatherResult | null = null;
  if (!planOverride && planResult.model) {
    try {
      gathered = await gatherCandidates(planResult.plan.queries, 60000, gatherOpts);
    } catch {
      gathered = null;
    }
  }
  if (!gathered) {
    gathered = (await gatherLocal) ?? null;
  }
  if (!gathered || gathered.candidates.length === 0) {
    // última tentativa com o plano final, janela curta
    try {
      gathered = await gatherCandidates(planResult.plan.queries.slice(0, 3), 40000, gatherOpts);
    } catch {
      /* mantém gathered */
    }
  }
  if (!gathered || gathered.candidates.length === 0) {
    throw new Error(
      "Não consegui confirmar nenhuma oferta agora — as lojas podem ter limitado o acesso do robô neste horário. Tente novamente em alguns segundos."
    );
  }

  const { candidates, sources, executedQueries } = gathered;
  if (candidates.length === 0) {
    throw new Error(
      "Não consegui confirmar nenhuma oferta agora — as lojas podem ter limitado o acesso do robô neste horário. Tente novamente em alguns segundos."
    );
  }

  let selection = await llmSelect(editalText, planResult.plan.requirements, candidates);
  let usedModel = selection.model ?? planResult.model;
  if (selection.verdicts.length === 0) {
    selection = { verdicts: naiveSelect(planResult.plan.requirements, candidates), model: null };
    usedModel = usedModel ? `${usedModel} + filtro local` : "filtro local";
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const seen = new Set<number>();
  const options: AnalyzedOption[] = [];
  for (const v of selection.verdicts) {
    const c = byId.get(v.id);
    if (!c || seen.has(v.id)) continue;
    seen.add(v.id);
    const trusted = siteFromUrl(c.url).trusted;
    options.push({
      brand: c.brand || v.brand || "—",
      name: c.name.slice(0, 200),
      price: c.price,
      url: c.url,
      site: c.site,
      compliant: v.compliant,
      complianceScore: v.complianceScore,
      isSimilar: v.isSimilar,
      missing: v.compliant ? [] : v.missing,
      trustedSite: trusted,
      priceSource: c.origin,
    });
  }

  // garante que ofertas não avaliadas entrem como referência quando há espaço
  if (options.length < 10) {
    const leftovers = candidates
      .filter((c) => !seen.has(c.id))
      .sort((a, b) => a.price - b.price)
      .slice(0, 10 - options.length);
    for (const c of leftovers) {
      options.push({
        brand: c.brand || "—",
        name: c.name.slice(0, 200),
        price: c.price,
        url: c.url,
        site: c.site,
        compliant: false,
        complianceScore: 30,
        isSimilar: true,
        missing: ["conformidade não confirmada — verifique as especificações no anúncio"],
        trustedSite: siteFromUrl(c.url).trusted,
        priceSource: c.origin,
      });
    }
  }

  /* ---- aplica os FILTROS escolhidos pelo usuário (servidor) ---- */
  const filteredByScore = options.filter(
    (o) =>
      o.complianceScore >= filters.minScore &&
      (filters.similarMode === "all" ||
        (filters.similarMode === "exact" ? !o.isSimilar : o.isSimilar))
  );
  // se o filtro cortar quase tudo, avisa mantendo o que restou + melhores não conformes como referência
  const kept =
    filteredByScore.length >= 3
      ? filteredByScore.slice(0, 10)
      : [...filteredByScore, ...options.filter((o) => !filteredByScore.includes(o)).slice(0, 10 - filteredByScore.length)];

  kept.sort((a, b) => {
    if (a.complianceScore !== b.complianceScore) return b.complianceScore - a.complianceScore;
    return a.price - b.price;
  });
  const finalOptions = kept.slice(0, 10);

  const prices = finalOptions.map((o) => o.price);
  return {
    title: planResult.plan.title,
    requirements: planResult.plan.requirements,
    options: finalOptions,
    sources,
    searchQueries: executedQueries,
    model: usedModel ?? "filtro local",
    stats: {
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      avg: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
    },
    appliedFilters: filters,
  };
}
