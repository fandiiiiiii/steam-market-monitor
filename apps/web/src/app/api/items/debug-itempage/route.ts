import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

/**
 * 临时调试接口：抓取物品页 HTML，侦察 nameid / 求购数据的嵌入位置。
 * 用法：/api/items/debug-itempage?appid=1203220&hash=Star%20-%20Rainbow%20Flow(CN)
 */
export async function GET(req: NextRequest) {
  const appId = Number(req.nextUrl.searchParams.get("appid") ?? 1203220);
  const hash = req.nextUrl.searchParams.get("hash") ?? "";
  if (!hash) return NextResponse.json({ error: "缺少 hash 参数" }, { status: 400 });
  const url = `https://steamcommunity.com/market/listings/${appId}/${encodeURIComponent(hash)}?l=schinese&country=CN`;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "text/html, */*",
        "accept-language": "zh-CN,zh;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(20000),
    });
    const html = await res.text();
    const loadOrder = html.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/);
    const nameidHits = (html.match(/.{60}nameid.{60}/gi) ?? []).slice(0, 3);
    const buyOrderHits = (html.match(/.{60}buy_order.{60}/gi) ?? []).slice(0, 3);
    const listingHits = (html.match(/.{40}listing_\d+.{40}/g) ?? []).slice(0, 3);
    const bodyIdx = html.search(/<body/i);
    return NextResponse.json(
      {
        status: res.status,
        htmlLength: html.length,
        loadOrderSpread: loadOrder ? Number(loadOrder[1]) : null,
        nameidHits,
        buyOrderHits,
        listingHits,
        bodyHead: bodyIdx >= 0 ? html.slice(bodyIdx, bodyIdx + 2500) : html.slice(0, 2500),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
