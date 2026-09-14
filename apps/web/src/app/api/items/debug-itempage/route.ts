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

    // 再侦察旧 render 接口在新参数下的行为（nameid / 订单数据的可能来源）
    let renderProbe: Record<string, unknown> = { error: "未执行" };
    try {
      const renderUrl = `https://steamcommunity.com/market/listings/${appId}/${encodeURIComponent(hash)}/render/?start=0&count=10&language=schinese&currency=23&norender=1`;
      const rr = await fetch(renderUrl, {
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "zh-CN,zh;q=0.9",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(20000),
      });
      const rt = await rr.text();
      let rp: unknown = null;
      try {
        rp = JSON.parse(rt);
      } catch {
        rp = null;
      }
      const robj = rp && typeof rp === "object" ? (rp as Record<string, unknown>) : null;
      renderProbe = {
        status: rr.status,
        isJson: rp != null,
        topLevelKeys: robj ? Object.keys(robj) : [],
        success: robj?.success ?? null,
        totalCount: robj?.total_count ?? null,
        rawHead: rt.slice(0, 1500),
      };
    } catch (e) {
      renderProbe = { error: e instanceof Error ? e.message : String(e) };
    }

    return NextResponse.json(
      {
        status: res.status,
        htmlLength: html.length,
        loadOrderSpread: loadOrder ? Number(loadOrder[1]) : null,
        nameidHits,
        buyOrderHits,
        listingHits,
        bodyHead: bodyIdx >= 0 ? html.slice(bodyIdx, bodyIdx + 1500) : html.slice(0, 1500),
        renderProbe,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
