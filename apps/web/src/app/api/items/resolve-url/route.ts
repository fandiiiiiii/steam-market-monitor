import { parseMarketUrl } from "@steam-monitor/core";
import { NextResponse, type NextRequest } from "next/server";
import { applySettingsToSteam, steam } from "@/lib/singletons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

/** 解析粘贴的商品市场 URL，并从物品页抓取官方名称（可选，失败不阻塞添加） */
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
    return NextResponse.json(
      { error: "无法从该链接解析出市场物品，请粘贴 https://steamcommunity.com/market/listings/... 形式的链接" },
      { status: 400 },
    );
  }
  let displayName: string | null = null;
  let warn: string | null = null;
  try {
    await applySettingsToSteam();
    const page = await steam.getItemPage(parsed.appId, parsed.marketHashName);
    displayName = page.name;
    if (!page.histogram && !page.name) {
      warn = "未能从物品页解析数据（可能物品不存在或未登录），添加后巡检时会再尝试";
    }
  } catch (e) {
    warn = `物品页解析失败（${e instanceof Error ? e.message : String(e)}），添加后巡检时会再尝试`;
  }
  return NextResponse.json({
    appId: parsed.appId,
    marketHashName: parsed.marketHashName,
    displayName,
    warn,
  });
}
