import { NextResponse } from "next/server";
import { storage } from "@/lib/persist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = Boolean(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY
  );
  const keySource = process.env.GEMINI_API_KEY
    ? "GEMINI_API_KEY"
    : process.env.GOOGLE_API_KEY
      ? "GOOGLE_API_KEY"
      : process.env.GOOGLE_GENERATIVE_AI_API_KEY
        ? "GOOGLE_GENERATIVE_AI_API_KEY"
        : null;
  return NextResponse.json({
    configured,
    keySource,
    model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    mercadoLivreApi: Boolean(process.env.MERCADO_LIVRE_CLIENT_ID && process.env.MERCADO_LIVRE_CLIENT_SECRET),
    /** "postgres" quando DATABASE_URL existe; "local" = arquivo .data/store.json */
    storage,
  });
}
