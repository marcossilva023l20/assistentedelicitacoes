import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { searches, searchResults } from "@/db/schema";
import type { SearchDetail } from "@/lib/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [search] = await db.select().from(searches).where(eq(searches.id, id)).limit(1);
  if (!search) return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });

  const rows = await db
    .select()
    .from(searchResults)
    .where(eq(searchResults.searchId, id))
    .orderBy(asc(searchResults.position));

  const detail: SearchDetail = {
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
      priceSource: r.priceSource === "busca" ? "busca" : r.priceSource === "busca_loja" ? "busca_loja" : r.priceSource === "comparador" ? "comparador" : "pagina",
    })),
  };
  return NextResponse.json({ search: detail });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await db.delete(searches).where(eq(searches.id, id));
  return NextResponse.json({ ok: true });
}
