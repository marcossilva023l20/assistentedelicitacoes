import { NextResponse } from "next/server";
import { createTrBatch } from "@/lib/persist";
import { extractTextFromFile, segmentTr } from "@/lib/termo";
import { GeminiUnreachableError, geminiText, InvalidKeyError, MissingKeyError } from "@/lib/gemini";
import { aiErrorResponse } from "@/lib/api-error";
import type { TrBatchState } from "@/lib/shared";

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

    const hasKey = Boolean(
      process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY
    );
    if (!hasKey) throw new MissingKeyError();

    // erros de chave/rede não podem virar "segmentação local" silenciosa
    const seg = await segmentTr(text, async (prompt, maxTokens) => {
      try {
        return await geminiText(prompt, maxTokens);
      } catch (err) {
        if (err instanceof InvalidKeyError || err instanceof GeminiUnreachableError) throw err;
        return null;
      }
    });
    if (seg.items.length === 0) {
      return NextResponse.json(
        {
          error:
            "Não consegui identificar itens numerados neste TR. Ajuste o documento (numere os itens, ex.: “Item 1 — …”) ou cole item por item no campo de busca.",
        },
        { status: 422 }
      );
    }

    const state: TrBatchState = await createTrBatch(file.name, seg.items);
    return NextResponse.json({ batch: state, via: seg.via });
  } catch (err) {
    const mapped = aiErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Falha ao processar o arquivo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
