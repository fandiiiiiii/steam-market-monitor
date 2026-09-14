import { NextResponse, type NextRequest } from "next/server";
import { steam } from "@/lib/singletons";
import { errMsg } from "@steam-monitor/core";

export const runtime = "nodejs";
export const maxDuration = 30;

/** 市场物品搜索（默认永劫无间 appid=1203220，可自定义 appid） */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const appId = Number(req.nextUrl.searchParams.get("appid") ?? 1203220);
  if (!q.trim()) return NextResponse.json({ results: [] });
  if (!Number.isFinite(appId) || appId <= 0) {
    return NextResponse.json({ error: "appid 无效" }, { status: 400 });
  }
  try {
    const results = await steam.searchItems(appId, q);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }
}
