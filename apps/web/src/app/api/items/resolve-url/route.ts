import { parseMarketUrl } from "@steam-monitor/core";
import { NextResponse, type NextRequest } from "next/server";
import { steam } from "@/lib/singletons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** 解析粘贴的商品市场 URL，并尝试预解析 nameid（可选，失败不阻塞添加） */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const parsed = parseMarketUrl(url);
  if (!parsed) {
    return NextResponse.json({ error: "无法从该链接解析出市场物品，请粘贴 https://steamcommunity.com/market/listings/... 形式的链接" }, { status: 400 });
  }
  let nameId: number | null = null;
  let warn: string | null = null;
  try {
    nameId = await steam.resolveNameId(parsed.appId, parsed.marketHashName);
    if (!nameId) warn = "未能预解析该物品的 nameid（可能物品名有误），添加后首次巡检会再尝试";
  } catch (e) {
    warn = `预解析 nameid 失败（${e instanceof Error ? e.message : String(e)}），添加后首次巡检会再尝试`;
  }
  return NextResponse.json({ appId: parsed.appId, marketHashName: parsed.marketHashName, nameId, warn });
}
