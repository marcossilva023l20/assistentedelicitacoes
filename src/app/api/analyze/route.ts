import { NextResponse } from "next/server";
import { analyzeEditalItem, MissingKeyError, QuotaError } from "@/lib/gemini";
import { persistAnalysis } from "@/lib/persist";

export const runtime = "nodejs";
export const maxDuration = 240;

type RawFilters = { minScore?: number; similarMode?: string };

export async function POST(req: Request) {
  let editalText = "";
  let rawFilters: RawFilters | undefined;
  try {
    const body = (await req.json()) as { editalText?: string; filters?: RawFilters };
    editalText = (body.editalText ?? "").trim();
    rawFilters = body.filters;
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  if (editalText.length < 15) {
    return NextResponse.json(
      { error: "Descreva o item do edital com suas especificações técnicas (mín. 15 caracteres)." },
      { status: 400 }
    );
  }
  if (editalText.length > 8000) {
    return NextResponse.json({ error: "Texto muito longo (máx. 8.000 caracteres)." }, { status: 400 });
  }

  try {
    const analysis = await analyzeEditalItem(
      editalText,
      undefined,
      rawFilters as { minScore?: number; similarMode?: "all" | "exact" | "similar" } | undefined
    );
    const detail = await persistAnalysis(analysis, editalText);
    return NextResponse.json({ search: detail });
  } catch (err) {
    if (err instanceof MissingKeyError) {
      return NextResponse.json({ error: "Chave da IA não configurada.", code: "MISSING_KEY" }, { status: 503 });
    }
    if (err instanceof QuotaError) {
      return NextResponse.json(
        {
          error: "Cota gratuita da IA atingida agora. Aguarde alguns minutos ou tente novamente mais tarde.",
          code: "QUOTA",
        },
        { status: 429 }
      );
    }
    const message = err instanceof Error ? err.message : "Erro inesperado na análise.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
