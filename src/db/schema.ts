import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export type SourceRef = { uri: string; title: string };

export type SearchFilters = {
  /** atendimento mínimo exigido (5 a 100) */
  minScore: number;
  /** all = todos · exact = apenas marca/modelo exato · similar = apenas equivalentes */
  similarMode: "all" | "exact" | "similar";
};

export type TrItemPayload = {
  order: number;
  label: string;
  title: string;
  editalText: string;
  qty: number | null;
};

export const trBatches = pgTable(
  "tr_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    filename: text("filename").notNull(),
    itemCount: integer("item_count").notNull().default(0),
    items: jsonb("items").$type<TrItemPayload[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tr_batches_created_at_idx").on(t.createdAt)]
);

export const searches = pgTable(
  "searches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    editalText: text("edital_text").notNull(),
    model: text("model"),
    batchId: uuid("batch_id").references(() => trBatches.id, { onDelete: "cascade" }),
    itemLabel: text("item_label"),
    filters: jsonb("filters").$type<SearchFilters | null>(),
    requirements: jsonb("requirements").$type<string[]>().notNull().default([]),
    sources: jsonb("sources").$type<SourceRef[]>().notNull().default([]),
    searchQueries: jsonb("search_queries").$type<string[]>().notNull().default([]),
    totalOptions: integer("total_options").notNull().default(0),
    fullMatches: integer("full_matches").notNull().default(0),
    minPrice: numeric("min_price", { precision: 12, scale: 2 }),
    maxPrice: numeric("max_price", { precision: 12, scale: 2 }),
    avgPrice: numeric("avg_price", { precision: 12, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("searches_created_at_idx").on(t.createdAt)]
);

export const searchResults = pgTable(
  "search_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => searches.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    brand: text("brand").notNull(),
    name: text("name").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    url: text("url").notNull(),
    site: text("site").notNull(),
    compliant: boolean("compliant").notNull().default(true),
    complianceScore: integer("compliance_score").notNull().default(100),
    isSimilar: boolean("is_similar").notNull().default(false),
    missing: jsonb("missing").$type<string[]>().notNull().default([]),
    trustedSite: boolean("trusted_site").notNull().default(false),
    priceSource: text("price_source").notNull().default("pagina"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("search_results_search_id_idx").on(t.searchId)]
);
