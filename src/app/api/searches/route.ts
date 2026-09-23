import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { searches } from "@/db/schema";
import type { SearchSummary } from "@/lib/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
  await db.delete(searches);
  return NextResponse.json({ ok: true, deletedAll: true });
}
