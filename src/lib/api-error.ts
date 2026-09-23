import { NextResponse } from "next/server";
import { GeminiUnreachableError, InvalidKeyError, MissingKeyError, QuotaError } from "@/lib/gemini";

/**
 * Respostas padronizadas para as quatro falhas de IA que o usuário pode
 * realmente encontrar. Devolve `null` para erros inesperados (a rota responde 500).
 */
export function aiErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof MissingKeyError) {
    return NextResponse.json(
      {
        error:
          "Chave da IA não configurada. Copie .env.example para .env.local, preencha GEMINI_API_KEY (https://aistudio.google.com/apikey) e reinicie o servidor.",
        code: "MISSING_KEY",
      },
      { status: 503 }
    );
  }
  if (err instanceof InvalidKeyError) {
    return NextResponse.json({ error: err.message, code: "INVALID_KEY" }, { status: 401 });
  }
  if (err instanceof QuotaError) {
    return NextResponse.json(
      {
        error:
          err.message || "Cota gratuita da IA atingida agora. Aguarde alguns minutos ou tente novamente mais tarde.",
        code: "QUOTA",
      },
      { status: 429 }
    );
  }
  if (err instanceof GeminiUnreachableError) {
    return NextResponse.json({ error: err.message, code: "GEMINI_OFFLINE" }, { status: 503 });
  }
  return null;
}
