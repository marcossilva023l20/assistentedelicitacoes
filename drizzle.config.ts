import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// lê DATABASE_URL de .env.local (o mesmo arquivo que o Next usa), com fallback
// para .env e para o Postgres local de desenvolvimento.
loadEnv({ path: ".env.local" });
loadEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  },
});
