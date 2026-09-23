/* Tipos e helpers compartilhados entre cliente e servidor (sem deps de server). */

export interface ResultItem {
  id: string;
  position: number;
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
  priceSource: "pagina" | "busca" | "busca_loja" | "comparador";
}

export interface AppliedFilters {
  minScore: number;
  similarMode: "all" | "exact" | "similar";
}

export interface SearchDetail {
  id: string;
  title: string;
  editalText: string;
  model: string | null;
  filters: AppliedFilters | null;
  requirements: string[];
  sources: { uri: string; title: string }[];
  searchQueries: string[];
  totalOptions: number;
  fullMatches: number;
  minPrice: number | null;
  maxPrice: number | null;
  avgPrice: number | null;
  createdAt: string;
  results: ResultItem[];
}

export interface SearchSummary {
  id: string;
  title: string;
  createdAt: string;
  totalOptions: number;
  fullMatches: number;
  minPrice: number | null;
  avgPrice: number | null;
  batchId?: string | null;
  itemLabel?: string | null;
}

/* --------- Termo de Referência (TR) --------- */

export interface TrItemState {
  order: number;
  label: string;
  title: string;
  editalText: string;
  qty: number | null;
  search: SearchSummary | null;
}

export interface TrBatchState {
  id: string;
  filename: string;
  itemCount: number;
  createdAt: string;
  items: TrItemState[];
}

export const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBRL(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return brl.format(v);
}

export function formatDateBR(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Relatório em texto puro, exatamente no formato pedido no edital de instruções. */
export function buildPlainReport(s: SearchDetail): string {
  const lines: string[] = [];
  lines.push(`PESQUISA DE PREÇOS — ${s.title.toUpperCase()}`);
  lines.push(`Gerado em ${formatDateBR(s.createdAt)} • ${s.totalOptions} opção(ões) • ${s.fullMatches} atendem 100% do edital`);
  if (s.requirements.length) {
    lines.push("");
    lines.push("Requisitos obrigatórios identificados:");
    s.requirements.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  }
  lines.push("");
  s.results.forEach((r, i) => {
    lines.push(`${i + 1}.`);
    lines.push(`Marca: ${r.brand}`);
    lines.push(`Nome completo do produto: ${r.name}`);
    lines.push(`Preço: ${formatBRL(r.price)}`);
    lines.push(`Link direto do anúncio: ${r.url}`);
    lines.push(`Site: ${r.site}`);
    if (!r.compliant && r.missing.length) {
      lines.push(`Atenção — não atende 100%: ${r.missing.join("; ")}`);
    }
    lines.push("");
  });
  lines.push(`Média de preço das opções listadas: ${formatBRL(s.avgPrice)}`);
  return lines.join("\n");
}

/** Relatório consolidado de um Termo de Referência (vários itens). */
export function buildTrReport(
  filename: string,
  items: { label: string; title: string; qty: number | null; detail: SearchDetail | null }[]
): string {
  const lines: string[] = [];
  lines.push("RELATÓRIO CONSOLIDADO DE PESQUISA DE PREÇOS — TERMO DE REFERÊNCIA");
  lines.push(`Arquivo: ${filename} • Gerado em ${formatDateBR(new Date().toISOString())}`);
  lines.push(`Itens: ${items.length}`);

  const done = items.filter((i) => i.detail && i.detail.minPrice != null);
  const total = done.reduce((acc, i) => acc + (i.detail!.minPrice as number) * (i.qty ?? 1), 0);

  lines.push("");
  lines.push("RESUMO POR ITEM");
  for (const i of items) {
    const min = i.detail?.minPrice ?? null;
    const est = min != null ? min * (i.qty ?? 1) : null;
    lines.push(
      `- ${i.label}: ${i.title} | Qtd: ${i.qty ?? 1} | Menor unit.: ${min != null ? formatBRL(min) : "sem cotação"} | Estimado: ${est != null ? formatBRL(est) : "—"}`
    );
  }
  lines.push("");
  lines.push(`VALOR ESTIMADO DO OBJETO (soma dos menores preços × quantidades): ${formatBRL(total)}`);

  for (const i of items) {
    if (!i.detail) continue;
    lines.push("");
    lines.push(`================ ${i.label.toUpperCase()} — ${i.title} (Qtd: ${i.qty ?? 1}) ================`);
    lines.push(buildPlainReport(i.detail));
  }
  return lines.join("\n");
}
