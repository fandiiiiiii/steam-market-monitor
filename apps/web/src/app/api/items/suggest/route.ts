import { NextResponse, type NextRequest } from "next/server";
import { steam } from "@/lib/singletons";
import { errMsg } from "@steam-monitor/core";
import { fuzzyMatch, getCatalog } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * 市场物品搜索（默认永劫无间 appid=1203220，可自定义 appid）。
 * 支持中文关键词：先直查 Steam（新接口可能直接支持），查不到再回退到
 * 本地目录索引（中文名模糊匹配，索引缓存 24 小时）。
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const appId = Number(req.nextUrl.searchParams.get("appid") ?? 1203220);
  if (!q.trim()) return NextResponse.json({ results: [] });
  if (!Number.isFinite(appId) || appId <= 0) {
    return NextResponse.json({ error: "appid 无效" }, { status: 400 });
  }
  try {
    let results = await steam.searchItems(appId, q);
    if (results.length === 0) {
      const catalog = await getCatalog(appId);
      results = fuzzyMatch(catalog, q);
    }
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }
}
