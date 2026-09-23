import { NextResponse } from "next/server";
import { clearSearches, listSearches } from "@/lib/persist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const searches = await listSearches(40);
  return NextResponse.json({ searches });
}

/** Esvazia a lixeira: apaga todas as cotações do histórico. */
export async function DELETE() {
  const deletedAll = await clearSearches();
  return NextResponse.json({ ok: true, deletedAll });
}
