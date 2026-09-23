import "server-only";
import type { TrItemPayload } from "@/db/schema";

/* ------------------------------------------------------------------ */
/* Extração de texto de arquivos                                       */
/* ------------------------------------------------------------------ */

const MAX_TEXT_CHARS = 30000;

export async function extractTextFromFile(filename: string, buf: Buffer): Promise<string> {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();

  if (ext === "pdf") {
    try {
      const { extractText } = await import("unpdf");
      const res = await extractText(new Uint8Array(buf), { mergePages: true });
      const t = res as unknown as { text?: string | string[] };
      const text = Array.isArray(t?.text) ? t.text.join("\n\n") : String(t?.text ?? "");
      return cleanupText(text);
    } catch (err) {
      throw new Error(
        `Não consegui ler este PDF (${err instanceof Error ? err.message.slice(0, 80) : "erro"}). Se for um PDF digitalizado (imagem), converta para texto ou envie DOCX/TXT.`
      );
    }
  }
  if (ext === "docx") {
    try {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return cleanupText(value);
    } catch {
      throw new Error("Não consegui ler este DOCX. Tente exportar como PDF ou TXT.");
    }
  }
  if (ext === "txt" || ext === "md" || ext === "csv") {
    return cleanupText(buf.toString("utf-8"));
  }
  throw new Error("Formato não suportado. Envie PDF, DOCX, TXT, MD ou CSV.");
}

function cleanupText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/* ------------------------------------------------------------------ */
/* Leitura de quantidade                                               */
/* ------------------------------------------------------------------ */

function parseQty(text: string): number | null {
  const m =
    text.match(/(?:qtde?|quant(?:idade)?|qtd|volume)\s*[:\–\-]?\s*(\d{1,6})/i) ??
    text.match(/(\d{1,5})\s*(?:unidades?|und?\.?|peças|pçs?|pares?|kits?|caixas?|cxs?|resmas?)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? n : null;
}

/* ------------------------------------------------------------------ */
/* Segmentação local (fallback sem IA)                                 */
/* ------------------------------------------------------------------ */

function localSegment(text: string): TrItemPayload[] {
  const lines = text.split("\n");
  const patterns = [
    /^\s*(?:item|lote)\s+(?:n[ºo°.]?\s*)?(\d{1,3})\b[\s.\):\-–—]?(.*)$/i,
    /^\s*(\d{1,3})\s*[.\)]\s+([A-ZÀ-Ú0-9"]\S.*)$/,
    /^\s*(\d{1,3})\s+[–—:]\s+([A-ZÀ-Ú0-9"]\S.*)$/,
  ];

  let best: number[] = [];
  let bestRe: RegExp | null = null;
  for (const re of patterns) {
    const idx: number[] = [];
    lines.forEach((line, i) => {
      if (re.test(line)) idx.push(i);
    });
    // precisa de ao menos 2 ocorrências e numeração razoavelmente sequencial
    if (idx.length > best.length) {
      best = idx;
      bestRe = re;
    }
  }
  if (!bestRe || best.length < 2) return [];

  const items: TrItemPayload[] = [];
  for (let s = 0; s < best.length && items.length < 25; s++) {
    const startLine = lines[best[s]];
    const end = best[s + 1] ?? lines.length;
    const chunk = lines.slice(best[s], end).join("\n").trim();
    if (chunk.length < 40) continue;
    const m = startLine.match(bestRe)!;
    const num = m[1];
    const rest = (m[2] ?? "").trim();
    const label = `Item ${Number(num)}`;
    const titleSource = rest || startLine;
    const title = titleSource
      .split(/[;,.\n]/)[0]
      .replace(/^(unidade|padrão|marca|aps\s*\d+)\s*[:\-]?\s*/i, "")
      .trim()
      .slice(0, 80);
    items.push({
      order: items.length + 1,
      label,
      title: title || label,
      editalText: chunk.slice(0, 1400),
      qty: parseQty(chunk),
    });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Segmentação com IA                                                  */
/* ------------------------------------------------------------------ */

export interface SegmentResult {
  items: TrItemPayload[];
  via: "ia" | "local";
}

export async function segmentTr(
  trText: string,
  geminiCall: (prompt: string, maxTokens: number) => Promise<{ text: string; model: string } | null>
): Promise<SegmentResult> {
  const prompt = `Você é especialista em licitações públicas brasileiras. O texto abaixo é um TERMO DE REFERÊNCIA com a descrição de vários itens de compra.

TAREFA: identifique e separe TODOS os itens individualizados (Item 1, Item 2, ... ou numeração equivalente). Para CADA item gere:
- "rotulo": a numeração como aparece no documento (ex.: "Item 3", "Lote 1 Item 2"). Se não houver, use "Item N" sequencial.
- "titulo": nome curto do objeto do item (máx. 70 caracteres).
- "quantidade": número inteiro se o documento informar a quantidade do item, senão null.
- "texto": a descrição COMPLETA do item em português, reunindo em um único parágrafo todas as especificações técnicas exigidas (medidas, capacidades, normas, materiais, garantia, prazo), mantendo números e unidades exatamente como no documento (máx. 900 caracteres). Se um anexo técnico detalhar o item, junte o essencial.

Regras:
- No máximo 25 itens. Ignore cabeçalhos, bases legais, condições gerais, prazos globais e tabelas de penalidades.
- Jamais invente especificações: use apenas o que está no texto.

Responda SOMENTE com um bloco \`\`\`json\`\`\` (sem texto fora dele):
{
  "itens": [
    { "rotulo": "Item 1", "titulo": "...", "quantidade": 10, "texto": "..." }
  ]
}

TERMO DE REFERÊNCIA:
"""
${trText.slice(0, 22000)}
"""`;

  const result = await geminiCall(prompt, 16384).catch(() => null);
  if (result) {
    const block = result.text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? result.text;
    try {
      const parsed = JSON.parse(block.slice(block.indexOf("{"), block.lastIndexOf("}") + 1)) as {
        itens?: unknown;
      };
      const out: TrItemPayload[] = [];
      for (const raw of Array.isArray(parsed.itens) ? parsed.itens : []) {
        const o = raw as Record<string, unknown>;
        const texto = typeof o.texto === "string" ? o.texto.trim() : "";
        if (texto.length < 30) continue;
        const qty = typeof o.quantidade === "number" && o.quantidade > 0 ? Math.floor(o.quantidade) : null;
        out.push({
          order: out.length + 1,
          label: (typeof o.rotulo === "string" && o.rotulo.trim()) || `Item ${out.length + 1}`,
          title: ((typeof o.titulo === "string" && o.titulo.trim()) || "Item do TR").slice(0, 90),
          editalText: texto.slice(0, 1400),
          qty: qty ?? parseQty(texto),
        });
        if (out.length >= 25) break;
      }
      if (out.length >= 1) return { items: out, via: "ia" };
    } catch {
      /* cai no fallback local */
    }
  }
  return { items: localSegment(trText), via: "local" };
}
