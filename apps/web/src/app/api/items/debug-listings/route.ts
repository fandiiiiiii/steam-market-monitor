import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

/**
 * 临时调试接口：原样返回物品页"加载更多"接口（render）的响应结构。
 * 用法：/api/items/debug-listings?appid=1203220&hash=Star%20-%20Dragon's%20Bane(Non-CN)
 */
export async function GET(req: NextRequest) {
  const appId = Number(req.nextUrl.searchParams.get("appid") ?? 1203220);
  const hash = req.nextUrl.searchParams.get("hash") ?? "";
  if (!hash) return NextResponse.json({ error: "缺少 hash 参数" }, { status: 400 });
  const url = `https://steamcommunity.com/market/listings/${appId}/${encodeURIComponent(hash)}/render/?start=0&count=100&currency=23&language=schinese&format=json`;
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
    const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    return NextResponse.json(
      {
        status: res.status,
        topLevelKeys: obj ? Object.keys(obj) : [],
        success: obj?.success ?? null,
        totalCount: obj?.total_count ?? null,
        rawHead: text.slice(0, 6000),
        rawLength: text.length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
