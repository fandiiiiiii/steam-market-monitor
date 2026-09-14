import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

/**
 * 临时调试接口：侦察物品页与 render 接口（找 nameid / 求购数据来源）。
 * 用法：/api/items/debug-itempage?appid=1203220&hash=Star%20-%20Rainbow%20Flow(CN)
 */
export async function GET(req: NextRequest) {
  const appId = Number(req.nextUrl.searchParams.get("appid") ?? 1203220);
  const hash = req.nextUrl.searchParams.get("hash") ?? "";
  if (!hash) return NextResponse.json({ error: "缺少 hash 参数" }, { status: 400 });

  const out: Record<string, unknown> = {};

  // 1) 物品页 SSR HTML 中的 nameid
  try {
    const res = await fetch(
      `https://steamcommunity.com/market/listings/${appId}/${encodeURIComponent(hash)}?l=schinese&country=CN`,
      {
        headers: {
          accept: "text/html, */*",
          "accept-language": "zh-CN,zh;q=0.9",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(20000),
      },
    );
    const html = await res.text();
    const loadOrder = html.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/);
    out.page = {
      status: res.status,
      htmlLength: html.length,
      loadOrderSpread: loadOrder ? Number(loadOrder[1]) : null,
      nameidOccurrences: (html.match(/nameid/gi) ?? []).length,
      buyOrderOccurrences: (html.match(/buy_order/gi) ?? []).length,
      listingRowOccurrences: (html.match(/listing_\d+/g) ?? []).length,
    };
  } catch (e) {
    out.page = { error: e instanceof Error ? e.message : String(e) };
  }

  // 2) render 接口（旧"加载更多"接口，带 XHR 请求头 + 各种参数组合）
  for (const [label, params] of [
    ["renderNorenderXhr", "start=0&count=10&language=schinese&currency=23&norender=1"],
    ["renderFormatJsonXhr", "start=0&count=10&language=schinese&currency=23&format=json"],
  ] as const) {
    try {
      const r = await fetch(
        `https://steamcommunity.com/market/listings/${appId}/${encodeURIComponent(hash)}/render/?${params}`,
        {
          headers: {
            accept: "application/json, text/plain, */*",
            "accept-language": "zh-CN,zh;q=0.9",
            "x-requested-with": "XMLHttpRequest",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          },
          signal: AbortSignal.timeout(20000),
        },
      );
      const t = await r.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(t);
      } catch {
        parsed = null;
      }
      const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
      out[label] = {
        status: r.status,
        isJson: parsed != null,
        topLevelKeys: obj ? Object.keys(obj).slice(0, 15) : [],
        success: obj?.success ?? null,
        totalCount: obj?.total_count ?? null,
        hasNameid: t.includes("nameid"),
        rawHead: t.slice(0, 2000),
      };
    } catch (e) {
      out[label] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // 3) 按物品名直接请求柱状图（替代 nameid 的尝试）
  try {
    const r = await fetch(
      `https://steamcommunity.com/market/itemordershistogram?country=CN&language=schinese&currency=23&market_hash_name=${encodeURIComponent(hash)}&two_factor=0`,
      {
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "zh-CN,zh;q=0.9",
          "x-requested-with": "XMLHttpRequest",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(20000),
      },
    );
    const t = await r.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(t);
    } catch {
      parsed = null;
    }
    const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    out.histogramByHash = {
      status: r.status,
      isJson: parsed != null,
      success: obj?.success ?? null,
      rawHead: t.slice(0, 1200),
    };
  } catch (e) {
    out.histogramByHash = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
