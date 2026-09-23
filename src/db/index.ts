import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

/**
 * O Postgres é OPCIONAL. Sem DATABASE_URL o app continua funcionando com o
 * armazenamento local em arquivo (ver `src/lib/local-store.ts`); com ele, usa o
 * banco. Importante: nunca lançar erro aqui — este módulo é importado por todas
 * as rotas de API e um throw no import derrubava o site inteiro com 500.
 */
export const isDbConfigured = Boolean(databaseUrl && databaseUrl.trim());

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool: Pool | null = isDbConfigured
  ? (globalForDb.__arenaNextJsPostgresqlPool ?? new Pool({ connectionString: databaseUrl!.trim() }))
  : null;

if (process.env.NODE_ENV !== "production" && pool) {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = pool ? drizzle(pool) : null;
