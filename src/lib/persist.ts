import "server-only";
import { db } from "@/db";
import { searches, searchResults } from "@/db/schema";
import type { AnalyzedSearch } from "@/lib/gemini";
import type { SearchDetail } from "@/lib/shared";

/** Persiste uma análise concluída e devolve o detalhe pronto para a UI. */
export async function persistAnalysis(
  analysis: AnalyzedSearch,
  editalText: string,
  batch?: { batchId: string; itemLabel: string; titlePrefix: string }
): Promise<SearchDetail> {
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
    results: savedResults.map((r) => ({
      id: r.id,
      position: r.position,
      brand: r.brand,
      name: r.name,
      price: Number(r.price),
      url: r.url,
      site: r.site,
      compliant: r.compliant,
      complianceScore: r.complianceScore,
      isSimilar: r.isSimilar,
      missing: r.missing,
      trustedSite: r.trustedSite,
      priceSource: r.priceSource === "busca" ? "busca" : r.priceSource === "busca_loja" ? "busca_loja" : r.priceSource === "comparador" ? "comparador" : "pagina",
    })),
  };
}
