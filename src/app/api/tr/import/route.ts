import { NextResponse } from "next/server";
import { db, isDbConfigured } from "@/db";
import { trBatches } from "@/db/schema";
import { extractTextFromFile, segmentTr } from "@/lib/termo";
import { geminiText } from "@/lib/gemini";
import type { TrBatchState } from "@/lib/shared";
import { memoryStore } from "@/lib/memory-store";

export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_FILE_BYTES = 12 * 1024 * 1024;

export async function POST(req: Request) {
  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f && typeof f === "object" && "arrayBuffer" in f) file = f as File;
  } catch {
    return NextResponse.json({ error: "Envie o arquivo do TR (multipart/form-data)." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "Arquivo muito grande (máx. 12 MB)." }, { status: 413 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    let text = "";
    let debugInfo: Record<string, unknown> = { fileSize: file.size, bufLen: buf.length, name: file.name };
    try {
      text = await extractTextFromFile(file.name, buf);
      debugInfo = { ...debugInfo, textLen: text.length, sample: text.slice(0, 160) };
    } catch (err) {
      debugInfo = { ...debugInfo, extractError: err instanceof Error ? err.message : String(err) };
      throw err;
    }
    if (text.length < 200) {
      return NextResponse.json(
        {
          error:
            "Extraí muito pouco texto deste arquivo. Se for um PDF digitalizado (escaneado como imagem), converta para texto (OCR) e envie novamente.",
          debug: debugInfo,
        },
        { status: 422 }
      );
    }

    // Mesmo sem GEMINI_API_KEY, segmentTr tem fallback local
    const seg = await segmentTr(text, geminiText);
    if (seg.items.length === 0) {
      return NextResponse.json(
        {
          error:
            "Não consegui identificar itens numerados neste TR. Ajuste o documento (numere os itens, ex.: “Item 1 — …”) ou cole item por item no campo de busca.",
        },
        { status: 422 }
      );
    }

    if (!isDbConfigured || !db) {
      const batch = memoryStore.createTrBatch(file.name, seg.items.map((it) => ({ ...it, search: null })));
      const state: TrBatchState = memoryStore.toTrBatchState(batch);
      return NextResponse.json({ batch: state, via: seg.via, mode: "memory" });
    }

    const [batch] = await db
      .insert(trBatches)
      .values({ filename: file.name, itemCount: seg.items.length, items: seg.items })
      .returning();

    const state: TrBatchState = {
      id: batch.id,
      filename: batch.filename,
      itemCount: batch.itemCount,
      createdAt: batch.createdAt.toISOString(),
      items: batch.items.map((it) => ({ ...it, search: null })),
    };
    return NextResponse.json({ batch: state, via: seg.via });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao processar o arquivo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
