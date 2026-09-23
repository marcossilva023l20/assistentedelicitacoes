import { pingStorage, storage } from "@/lib/persist";

export const dynamic = "force-dynamic";

export async function GET() {
  const ok = await pingStorage();
  return Response.json(
    { ok, storage },
    { status: ok ? 200 : 503 }
  );
}
