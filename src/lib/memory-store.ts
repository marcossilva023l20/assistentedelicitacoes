/* Fallback in-memory storage when DATABASE_URL is not configured.
   Mirrors the shape needed by the API routes.
*/
import type { SearchDetail, SearchSummary, TrBatchState, TrItemState } from "@/lib/shared";

type StoredSearch = SearchDetail & { batchId?: string | null; itemLabel?: string | null };
type TrBatch = {
  id: string;
  filename: string;
  itemCount: number;
  createdAt: string;
  items: TrItemState[];
};

class MemoryStore {
  searches = new Map<string, StoredSearch>();
  trBatches = new Map<string, TrBatch>();

  // singleton
  private static instance: MemoryStore;
  static get(): MemoryStore {
    if (!this.instance) this.instance = new MemoryStore();
    return this.instance;
  }

  saveSearch(detail: SearchDetail, batch?: { batchId: string; itemLabel: string }): SearchDetail {
    const stored: StoredSearch = {
      ...detail,
      batchId: batch?.batchId ?? null,
      itemLabel: batch?.itemLabel ?? null,
    };
    this.searches.set(detail.id, stored);
    return detail;
  }

  getSearch(id: string): StoredSearch | undefined {
    return this.searches.get(id);
  }

  listSearches(limit = 40): SearchSummary[] {
    const all = Array.from(this.searches.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
    return all.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
      totalOptions: r.totalOptions,
      fullMatches: r.fullMatches,
      minPrice: r.minPrice,
      avgPrice: r.avgPrice,
      batchId: (r as StoredSearch).batchId ?? null,
      itemLabel: (r as StoredSearch).itemLabel ?? null,
    }));
  }

  deleteSearch(id: string) {
    this.searches.delete(id);
  }

  deleteAll() {
    this.searches.clear();
  }

  // TR batches
  createTrBatch(filename: string, items: TrItemState[]): TrBatch {
    const id = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const batch: TrBatch = {
      id,
      filename,
      itemCount: items.length,
      createdAt: new Date().toISOString(),
      items: items.map((it) => ({ ...it, search: null })),
    };
    this.trBatches.set(id, batch);
    return batch;
  }

  getTrBatch(id: string): TrBatch | undefined {
    return this.trBatches.get(id);
  }

  getLatestTrBatch(): TrBatch | undefined {
    const all = Array.from(this.trBatches.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return all[0];
  }

  linkSearchToTrItem(batchId: string, label: string, summary: SearchSummary) {
    const batch = this.trBatches.get(batchId);
    if (!batch) return;
    batch.items = batch.items.map((it) => (it.label === label ? { ...it, search: summary } : it));
  }

  toTrBatchState(batch: TrBatch): TrBatchState {
    // enrich with latest searches
    const byLabel = new Map<string, SearchSummary>();
    for (const s of this.listSearches(200)) {
      if (s.batchId === batch.id && s.itemLabel && !byLabel.has(s.itemLabel)) {
        byLabel.set(s.itemLabel, s);
      }
    }
    return {
      id: batch.id,
      filename: batch.filename,
      itemCount: batch.itemCount,
      createdAt: batch.createdAt,
      items: batch.items.map((it) => ({
        ...it,
        search: byLabel.get(it.label) ?? it.search ?? null,
      })),
    };
  }
}

export const memoryStore = MemoryStore.get();
