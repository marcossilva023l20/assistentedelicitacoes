import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, isDbConfigured } from "@/db";
import { searches } from "@/db/schema";
import type { SearchSummary } from "@/lib/shared";
import { memoryStore } from "@/lib/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDbConfigured || !db) {
    return NextResponse.json({ searches: memoryStore.listSearches(40) });
  }
  const rows = await db.select().from(searches).orderBy(desc(searches.createdAt)).limit(40);
  const list: SearchSummary[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.createdAt.toISOString(),
    totalOptions: r.totalOptions,
    fullMatches: r.fullMatches,
    minPrice: r.minPrice != null ? Number(r.minPrice) : null,
    avgPrice: r.avgPrice != null ? Number(r.avgPrice) : null,
  }));
  return NextResponse.json({ searches: list });
}

/** Esvazia a lixeira: apaga todas as cotações do histórico. */
export async function DELETE() {
  if (!isDbConfigured || !db) {
    memoryStore.deleteAll();
    return NextResponse.json({ ok: true, deletedAll: true, mode: "memory" });
  }
  await db.delete(searches);
  return NextResponse.json({ ok: true, deletedAll: true });
}
