import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { trBatches } from "@/db/schema";
import { analyzeEditalItem, MissingKeyError, QuotaError } from "@/lib/gemini";
import { persistAnalysis } from "@/lib/persist";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(req: Request) {
  let batchId = "";
  let order = 0;
  try {
    const body = (await req.json()) as { batchId?: string; order?: number };
    batchId = (body.batchId ?? "").trim();
    order = Number(body.order ?? 0);
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  if (!batchId || !Number.isInteger(order) || order < 1) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  const [batch] = await db.select().from(trBatches).where(eq(trBatches.id, batchId)).limit(1);
  if (!batch) return NextResponse.json({ error: "TR não encontrado." }, { status: 404 });
  const item = batch.items.find((it) => it.order === order);
  if (!item) return NextResponse.json({ error: "Item não encontrado neste TR." }, { status: 404 });

  try {
    const analysis = await analyzeEditalItem(item.editalText);
    const detail = await persistAnalysis(analysis, item.editalText, {
      batchId: batch.id,
      itemLabel: item.label,
      titlePrefix: item.label,
    });
    return NextResponse.json({ search: detail, itemLabel: item.label, order });
  } catch (err) {
    if (err instanceof MissingKeyError) {
      return NextResponse.json({ error: "Chave da IA não configurada.", code: "MISSING_KEY" }, { status: 503 });
    }
    if (err instanceof QuotaError) {
      return NextResponse.json(
        {
          error: "Cota gratuita da IA atingida agora. Aguarde alguns minutos e continue a busca de onde parou.",
          code: "QUOTA",
        },
        { status: 429 }
      );
    }
    const message = err instanceof Error ? err.message : "Erro inesperado na análise.";
    return NextResponse.json({ error: message, order }, { status: 500 });
  }
}
