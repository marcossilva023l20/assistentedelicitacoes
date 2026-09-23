import { NextResponse } from "next/server";
import { deleteSearch, getSearchDetail } from "@/lib/persist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });

  const search = await getSearchDetail(id);
  if (!search) return NextResponse.json({ error: "Pesquisa não encontrada." }, { status: 404 });
  return NextResponse.json({ search });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await deleteSearch(id);
  return NextResponse.json({ ok: true });
}
