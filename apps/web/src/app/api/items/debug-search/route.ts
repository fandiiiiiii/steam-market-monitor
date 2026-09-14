import { NextResponse, type NextRequest } from "next/server";
import { store } from "@/lib/singletons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

/**
 * 临时调试接口：原样返回 Steam 市场搜索接口的响应结构（用于校准解析器）。
 * 会带上设置里配置的 Steam Cookie（如有），以观察账号原生币种。
 * 用法：/api/items/debug-search?appid=1203220&q=Star （q 留空则不带 query 参数）
 */
export async function GET(req: NextRequest) {
  const appId = Number(req.nextUrl.searchParams.get("appid") ?? 1203220);
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const settings = await store.getSettings();
  const cookie = settings.steamCookie;
  const queryPart = q.trim() ? `query=${encodeURIComponent(q.trim())}&` : "";
  const url = `https://steamcommunity.com/market/search/render/?${queryPart}start=0&count=100&search_descriptions=0&appid=${appId}&currency=23&country=CN&l=schinese&norender=1`;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "zh-CN,zh;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        ...(cookie ? { cookie } : {}),
      },
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    const results = Array.isArray(obj?.results) ? (obj!.results as unknown[]) : [];
    return NextResponse.json(
      {
        status: res.status,
        topLevelKeys: obj ? Object.keys(obj) : [],
        totalCount: obj?.total_count ?? null,
        resultsCount: results.length,
        firstResult: results[0] ?? null,
        rawHead: text.slice(0, 4000),
        rawLength: text.length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
