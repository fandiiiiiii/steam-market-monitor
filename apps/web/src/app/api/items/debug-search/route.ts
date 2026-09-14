import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

/**
 * 临时调试接口：原样返回 Steam 市场搜索接口的响应（用于校准解析器）。
 * 用法：/api/items/debug-search?appid=1203220&q=Star （q 留空则不带 query 参数）
 */
export async function GET(req: NextRequest) {
  const appId = Number(req.nextUrl.searchParams.get("appid") ?? 1203220);
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const queryPart = q.trim() ? `query=${encodeURIComponent(q.trim())}&` : "";
  const url = `https://steamcommunity.com/market/search/render/?${queryPart}start=0&count=20&search_descriptions=0&appid=${appId}&currency=23&l=schinese&norender=1`;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "zh-CN,zh;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
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
    const html = parsed && typeof parsed === "object" && "results_html" in (parsed as Record<string, unknown>)
      ? String((parsed as Record<string, unknown>).results_html)
      : "";
    return NextResponse.json(
      {
        status: res.status,
        success: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).success : null,
        totalCount: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).total_count : null,
        resultsHtmlLength: html.length,
        resultsHtmlHead: html.slice(0, 5000),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
