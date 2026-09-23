import { NextResponse } from "next/server";
import {
  analyzeProductImage,
  analyzeEditalItem,
  MissingKeyError,
  QuotaError,
} from "@/lib/gemini";
import { persistAnalysis } from "@/lib/persist";

export const runtime = "nodejs";
export const maxDuration = 240;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export async function POST(req: Request) {
  let buf: Buffer;
  let mime = "image/jpeg";
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!f || typeof f !== "object" || !("arrayBuffer" in f)) {
      return NextResponse.json({ error: "Envie uma imagem (multipart/form-data)." }, { status: 400 });
    }
    const file = f as File;
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Imagem muito grande (máx. 8 MB)." }, { status: 413 });
    }
    mime = (file.type || "image/jpeg").toLowerCase();
    if (!ALLOWED.has(mime)) {
      return NextResponse.json({ error: "Formato não suportado. Use JPG, PNG ou WEBP." }, { status: 400 });
    }
    buf = Buffer.from(await file.arrayBuffer());
    if (buf.length < 1024) {
      return NextResponse.json({ error: "Imagem inválida ou vazia." }, { status: 400 });
    }
    if (mime === "image/heic" || mime === "image/heif") {
      // alguns modelos rejeitam heic — o cliente já converte para jpeg; guarda de segurança
      return NextResponse.json({ error: "Converta a foto para JPG (ex.: exporte ou capture em JPG)." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Não consegui ler a imagem enviada." }, { status: 400 });
  }

  try {
    const plan = await analyzeProductImage(buf, mime);
    const analysis = await analyzeEditalItem(plan.description, plan);
    const detail = await persistAnalysis(analysis, plan.description);
    return NextResponse.json({ search: detail, identified: { title: plan.title, description: plan.description } });
  } catch (err) {
    if (err instanceof MissingKeyError) {
      return NextResponse.json({ error: "Chave da IA não configurada.", code: "MISSING_KEY" }, { status: 503 });
    }
    if (err instanceof QuotaError) {
      return NextResponse.json(
        { error: err.message, code: "QUOTA" },
        { status: 429 }
      );
    }
    const message = err instanceof Error ? err.message : "Erro inesperado na análise da imagem.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
