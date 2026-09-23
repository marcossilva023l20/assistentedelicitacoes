import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, isDbConfigured } from "@/db";
import { searchResults, searches, trBatches, type TrItemPayload } from "@/db/schema";
import type { AnalyzedSearch } from "@/lib/gemini";
import { localStore } from "@/lib/local-store";
import type { AppliedFilters, ResultItem, SearchDetail, SearchSummary, TrBatchState } from "@/lib/shared";

/**
 * Camada única de persistência usada pelas rotas de API.
 * - `postgres`: DATABASE_URL configurada → Postgres (drizzle-orm).
 * - `local`:    sem Postgres → arquivo .data/store.json (ou memória, se somente leitura).
 *
 * `persist` = gravação; as funções abaixo também cobrem leitura do histórico e dos TRs.
 */
export type StorageMode = "postgres" | "local";
export const storage: StorageMode = isDbConfigured ? "postgres" : "local";

type SearchRow = typeof searches.$inferSelect;
type ResultRow = typeof searchResults.$inferSelect;

const PRICE_SOURCES = new Set<ResultItem["priceSource"]>(["pagina", "busca", "busca_loja", "comparador"]);

function priceSourceOf(v: string | null | undefined): ResultItem["priceSource"] {
  return PRICE_SOURCES.has(v as ResultItem["priceSource"]) ? (v as ResultItem["priceSource"]) : "pagina";
}

function rowsToDetail(search: SearchRow, rows: ResultRow[]): SearchDetail {
  return {
    id: search.id,
    title: search.title,
    editalText: search.editalText,
    model: search.model,
    filters: search.filters ?? null,
    requirements: search.requirements,
    sources: search.sources,
    searchQueries: search.searchQueries,
    totalOptions: search.totalOptions,
    fullMatches: search.fullMatches,
    minPrice: search.minPrice != null ? Number(search.minPrice) : null,
    maxPrice: search.maxPrice != null ? Number(search.maxPrice) : null,
    avgPrice: search.avgPrice != null ? Number(search.avgPrice) : null,
    createdAt: search.createdAt.toISOString(),
    results: rows.map((r) => ({
      id: r.id,
      position: r.position,
      brand: r.brand,
      name: r.name,
      price: Number(r.price),
      url: r.url,
      site: r.site,
      compliant: r.compliant,
      complianceScore: r.complianceScore ?? (r.compliant ? 100 : 50),
      isSimilar: r.isSimilar ?? false,
      missing: r.missing,
      trustedSite: r.trustedSite,
      priceSource: priceSourceOf(r.priceSource),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Escrita                                                             */
/* ------------------------------------------------------------------ */

/** Persiste uma análise concluída e devolve o detalhe pronto para a UI. */
export async function persistAnalysis(
  analysis: AnalyzedSearch,
  editalText: string,
  batch?: { batchId: string; itemLabel: string; titlePrefix: string }
): Promise<SearchDetail> {
  if (!db) {
    const detail = localStore.makeDetail({
      title: analysis.title,
      editalText,
      model: analysis.model,
      filters: (analysis.appliedFilters as AppliedFilters | undefined) ?? null,
      requirements: analysis.requirements,
      sources: analysis.sources,
      searchQueries: analysis.searchQueries,
      options: analysis.options.map((o) => ({
        brand: o.brand,
        name: o.name,
        price: o.price,
        url: o.url,
        site: o.site,
        compliant: o.compliant,
        complianceScore: o.complianceScore,
        isSimilar: o.isSimilar,
        missing: o.missing,
        trustedSite: o.trustedSite,
        priceSource: o.priceSource,
      })),
      stats: analysis.stats,
    });
    return localStore.saveSearch(detail, batch);
  }

  const [search] = await db
    .insert(searches)
    .values({
      title: (batch ? `${batch.titlePrefix} — ${analysis.title}` : analysis.title).slice(0, 200),
      editalText,
      model: analysis.model,
      requirements: analysis.requirements,
      sources: analysis.sources,
      searchQueries: analysis.searchQueries,
      totalOptions: analysis.options.length,
      fullMatches: analysis.options.filter((o) => o.compliant).length,
      minPrice: analysis.stats.min?.toFixed(2) ?? null,
      maxPrice: analysis.stats.max?.toFixed(2) ?? null,
      avgPrice: analysis.stats.avg?.toFixed(2) ?? null,
      batchId: batch?.batchId ?? null,
      itemLabel: batch?.itemLabel ?? null,
      filters: analysis.appliedFilters ?? null,
    })
    .returning();

  const rows = analysis.options.map((o, i) => ({
    searchId: search.id,
    position: i + 1,
    brand: o.brand,
    name: o.name,
    price: o.price.toFixed(2),
    url: o.url,
    site: o.site,
    compliant: o.compliant,
    complianceScore: o.complianceScore,
    isSimilar: o.isSimilar,
    missing: o.missing,
    trustedSite: o.trustedSite,
    priceSource: o.priceSource,
  }));
  const savedResults = rows.length ? await db.insert(searchResults).values(rows).returning() : [];

  return rowsToDetail(search, savedResults);
}

/* ------------------------------------------------------------------ */
/* Leitura / remoção — histórico                                         */
/* ------------------------------------------------------------------ */

export async function listSearches(limit = 40): Promise<SearchSummary[]> {
  if (!db) return localStore.listSearches(limit);
  const rows = await db.select().from(searches).orderBy(desc(searches.createdAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.createdAt.toISOString(),
    totalOptions: r.totalOptions,
    fullMatches: r.fullMatches,
    minPrice: r.minPrice != null ? Number(r.minPrice) : null,
    avgPrice: r.avgPrice != null ? Number(r.avgPrice) : null,
    ...(r.batchId ? { batchId: r.batchId, itemLabel: r.itemLabel ?? undefined } : {}),
  }));
}

export async function getSearchDetail(id: string): Promise<SearchDetail | null> {
  if (!db) {
    const found = localStore.getSearch(id);
    return found ? { ...found } : null;
  }
  const [search] = await db.select().from(searches).where(eq(searches.id, id)).limit(1);
  if (!search) return null;
  const rows = await db
    .select()
    .from(searchResults)
    .where(eq(searchResults.searchId, id))
    .orderBy(asc(searchResults.position));
  return rowsToDetail(search, rows);
}

export async function deleteSearch(id: string): Promise<void> {
  if (!db) {
    localStore.deleteSearch(id);
    return;
  }
  await db.delete(searches).where(eq(searches.id, id));
}

/** Esvazia a lixeira: apaga todas as cotações do histórico. */
export async function clearSearches(): Promise<number> {
  if (!db) return localStore.clearSearches();
  const removed = await db.delete(searches).returning({ id: searches.id });
  return removed.length;
}

/* ------------------------------------------------------------------ */
/* Termo de Referência                                                   */
/* ------------------------------------------------------------------ */

export async function createTrBatch(filename: string, items: TrItemPayload[]): Promise<TrBatchState> {
  if (!db) {
    const batch = localStore.createTrBatch(filename, items);
    return {
      id: batch.id,
      filename: batch.filename,
      itemCount: batch.itemCount,
      createdAt: batch.createdAt,
      items: batch.items.map((it) => ({ ...it, search: null })),
    };
  }
  const [batch] = await db
    .insert(trBatches)
    .values({ filename, itemCount: items.length, items })
    .returning();
  return {
    id: batch.id,
    filename: batch.filename,
    itemCount: batch.itemCount,
    createdAt: batch.createdAt.toISOString(),
    items: batch.items.map((it) => ({ ...it, search: null })),
  };
}

async function buildTrState(batchId: string, filename: string, itemCount: number, createdAt: string, items: TrItemPayload[]): Promise<TrBatchState> {
  const done = await listSearches(200);
  const byLabel = new Map<string, SearchSummary>();
  for (const s of done) {
    if (!s.itemLabel || s.batchId !== batchId || byLabel.has(s.itemLabel)) continue;
    byLabel.set(s.itemLabel, s);
  }
  return {
    id: batchId,
    filename,
    itemCount,
    createdAt,
    items: items.map((it) => ({ ...it, search: byLabel.get(it.label) ?? null })),
  };
}

export async function getLatestTrBatch(): Promise<TrBatchState | null> {
  if (!db) {
    const batch = localStore.latestTrBatch();
    if (!batch) return null;
    return buildTrState(batch.id, batch.filename, batch.itemCount, batch.createdAt, batch.items);
  }
  const [batch] = await db.select().from(trBatches).orderBy(desc(trBatches.createdAt)).limit(1);
  if (!batch) return null;
  return buildTrState(batch.id, batch.filename, batch.itemCount, batch.createdAt.toISOString(), batch.items);
}

export async function getTrBatch(id: string): Promise<TrBatchState | null> {
  if (!db) {
    const batch = localStore.getTrBatch(id);
    if (!batch) return null;
    return buildTrState(batch.id, batch.filename, batch.itemCount, batch.createdAt, batch.items);
  }
  const [batch] = await db.select().from(trBatches).where(eq(trBatches.id, id)).limit(1);
  if (!batch) return null;
  return buildTrState(batch.id, batch.filename, batch.itemCount, batch.createdAt.toISOString(), batch.items);
}

/* ------------------------------------------------------------------ */
/* Saúde do armazenamento                                                */
/* ------------------------------------------------------------------ */

export async function pingStorage(): Promise<boolean> {
  if (!db) return true; // modo local não depende de serviço externo
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
