import { NextResponse, type NextRequest } from "next/server";
import { store } from "@/lib/singletons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** 事件日志（可按物品过滤） */
export async function GET(req: NextRequest) {
  const itemId = req.nextUrl.searchParams.get("itemId") ?? undefined;
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 200) || 200, 500);
  const events = await store.getEvents(itemId, limit);
  return NextResponse.json({ events });
}
