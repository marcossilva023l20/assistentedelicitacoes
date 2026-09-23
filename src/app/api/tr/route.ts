import { NextResponse } from "next/server";
import { getLatestTrBatch } from "@/lib/persist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const batch = await getLatestTrBatch();
  return NextResponse.json({ batch });
}
