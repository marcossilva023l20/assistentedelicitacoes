/* Fallback de persistência quando DATABASE_URL não está configurado.

   NÃO é mock: guarda os resultados reais das análises (IA + lojas) num arquivo
   JSON versionado fora do git (.data/store.json). Se o sistema de arquivos for
   somente leitura (ex.: Vercel/lambda), segue funcionando em memória.
*/

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AppliedFilters, ResultItem, SearchDetail, SearchSummary } from "@/lib/shared";
import type { TrItemState } from "@/lib/shared";

export interface LocalSearchRecord extends SearchDetail {
  batchId: string | null;
  itemLabel: string | null;
}

export interface LocalTrItem {
  order: number;
  label: string;
  title: string;
  editalText: string;
  qty: number | null;
}

export interface LocalTrBatch {
  id: string;
  filename: string;
  itemCount: number;
  createdAt: string;
  items: LocalTrItem[];
}

interface Snapshot {
  searches: LocalSearchRecord[];
  trBatches: LocalTrBatch[];
}

const MAX_SEARCHES = 200;
const MAX_BATCHES = 20;

const FILE_PATH = join(process.cwd(), ".data", "store.json");

function emptySnapshot(): Snapshot {
  return { searches: [], trBatches: [] };
}

class LocalStore {
  private data: Snapshot = emptySnapshot();
  private loaded = false;
  private diskDisabled = false;

  /** Lê o arquivo uma vez por processo. */
  private ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = readFileSync(FILE_PATH, "utf8");
      const parsed = JSON.parse(raw) as Partial<Snapshot>;
      if (Array.isArray(parsed.searches)) this.data.searches = parsed.searches;
      if (Array.isArray(parsed.trBatches)) this.data.trBatches = parsed.trBatches;
    } catch {
      // arquivo ausente/corrompido → começa vazio
    }
  }

  private persist() {
    if (this.diskDisabled) return;
    try {
      mkdirSync(dirname(FILE_PATH), { recursive: true });
      const tmp = `${FILE_PATH}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data), "utf8");
      renameSync(tmp, FILE_PATH);
    } catch {
      // sistema de arquivos somente leitura → segue só em memória
      this.diskDisabled = true;
    }
  }

  /** true quando o histórico sobrevive a restarts (disco disponível). */
  get persistent() {
    this.ensureLoaded();
    return !this.diskDisabled;
  }

  saveSearch(
    detail: SearchDetail,
    batch?: { batchId: string; itemLabel: string; titlePrefix: string }
  ): LocalSearchRecord {
    this.ensureLoaded();
    const record: LocalSearchRecord = {
      ...detail,
      id: detail.id || randomUUID(),
      title: (batch ? `${batch.titlePrefix} — ${detail.title}` : detail.title).slice(0, 200),
      batchId: batch?.batchId ?? null,
      itemLabel: batch?.itemLabel ?? null,
    };
    this.data.searches = [record, ...this.data.searches.filter((s) => s.id !== record.id)].slice(
      0,
      MAX_SEARCHES
    );
    this.persist();
    return record;
  }

  listSearches(limit = 40): SearchSummary[] {
    this.ensureLoaded();
    return this.data.searches.slice(0, limit).map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      totalOptions: s.totalOptions,
      fullMatches: s.fullMatches,
      minPrice: s.minPrice,
      avgPrice: s.avgPrice,
      ...(s.batchId ? { batchId: s.batchId, itemLabel: s.itemLabel } : {}),
    }));
  }

  getSearch(id: string): LocalSearchRecord | null {
    this.ensureLoaded();
    return this.data.searches.find((s) => s.id === id) ?? null;
  }

  listSearchesByBatch(batchId: string): SearchSummary[] {
    this.ensureLoaded();
    return this.data.searches.filter((s) => s.batchId === batchId).map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      totalOptions: s.totalOptions,
      fullMatches: s.fullMatches,
      minPrice: s.minPrice,
      avgPrice: s.avgPrice,
      batchId: s.batchId,
      itemLabel: s.itemLabel,
    }));
  }

  deleteSearch(id: string) {
    this.ensureLoaded();
    this.data.searches = this.data.searches.filter((s) => s.id !== id);
    this.persist();
  }

  clearSearches(): number {
    this.ensureLoaded();
    const removed = this.data.searches.length;
    this.data.searches = [];
    this.persist();
    return removed;
  }

  createTrBatch(filename: string, items: TrItemState[] | LocalTrItem[]): LocalTrBatch {
    this.ensureLoaded();
    const batch: LocalTrBatch = {
      id: randomUUID(),
      filename,
      itemCount: items.length,
      createdAt: new Date().toISOString(),
      items: items.map((it) => ({
        order: it.order,
        label: it.label,
        title: it.title,
        editalText: it.editalText,
        qty: it.qty ?? null,
      })),
    };
    this.data.trBatches = [batch, ...this.data.trBatches].slice(0, MAX_BATCHES);
    this.persist();
    return batch;
  }

  getTrBatch(id: string): LocalTrBatch | null {
    this.ensureLoaded();
    return this.data.trBatches.find((b) => b.id === id) ?? null;
  }

  latestTrBatch(): LocalTrBatch | null {
    this.ensureLoaded();
    return this.data.trBatches[0] ?? null;
  }

  /** Reconstrói um SearchDetail a partir de uma análise (usado por persist). */
  makeDetail(args: {
    title: string;
    editalText: string;
    model: string | null;
    filters: AppliedFilters | null;
    requirements: string[];
    sources: { uri: string; title: string }[];
    searchQueries: string[];
    options: Omit<ResultItem, "id" | "position">[];
    stats: { min: number | null; max: number | null; avg: number | null };
  }): SearchDetail {
    const results: ResultItem[] = args.options.map((o, i) => ({ ...o, id: randomUUID(), position: i + 1 }));
    return {
      id: randomUUID(),
      title: args.title,
      editalText: args.editalText,
      model: args.model,
      filters: args.filters,
      requirements: args.requirements,
      sources: args.sources,
      searchQueries: args.searchQueries,
      totalOptions: args.options.length,
      fullMatches: args.options.filter((o) => o.compliant).length,
      minPrice: args.stats.min,
      maxPrice: args.stats.max,
      avgPrice: args.stats.avg,
      createdAt: new Date().toISOString(),
      results,
    };
  }
}

const globalForLocal = globalThis as typeof globalThis & { __licitaLocalStore?: LocalStore };

export const localStore: LocalStore = (globalForLocal.__licitaLocalStore ??= new LocalStore());
