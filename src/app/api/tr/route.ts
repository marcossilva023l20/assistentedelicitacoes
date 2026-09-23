import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, isDbConfigured } from "@/db";
import { searches, trBatches } from "@/db/schema";
import type { SearchSummary, TrBatchState } from "@/lib/shared";
import { memoryStore } from "@/lib/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDbConfigured || !db) {
    const batch = memoryStore.getLatestTrBatch();
    if (!batch) return NextResponse.json({ batch: null });
    return NextResponse.json({ batch: memoryStore.toTrBatchState(batch) });
  }

  const [batch] = await db.select().from(trBatches).orderBy(desc(trBatches.createdAt)).limit(1);
  if (!batch) return NextResponse.json({ batch: null });

  const rows = await db
    .select()
    .from(searches)
    .where(eq(searches.batchId, batch.id))
    .orderBy(desc(searches.createdAt));

  const byLabel = new Map<string, SearchSummary>();
  for (const r of rows) {
    if (!r.itemLabel || byLabel.has(r.itemLabel)) continue;
    byLabel.set(r.itemLabel, {
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      totalOptions: r.totalOptions,
      fullMatches: r.fullMatches,
      minPrice: r.minPrice != null ? Number(r.minPrice) : null,
      avgPrice: r.avgPrice != null ? Number(r.avgPrice) : null,
      batchId: r.batchId,
      itemLabel: r.itemLabel,
    });
  }

  const state: TrBatchState = {
    id: batch.id,
    filename: batch.filename,
    itemCount: batch.itemCount,
    createdAt: batch.createdAt.toISOString(),
    items: batch.items.map((it) => ({ ...it, search: byLabel.get(it.label) ?? null })),
  };
  return NextResponse.json({ batch: state });
}
