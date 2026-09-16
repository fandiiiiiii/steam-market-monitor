import { NextResponse, type NextRequest } from "next/server";
import { applySettingsToSteam, steam } from "@/lib/singletons";
import { parseItemPageOrders, errMsg } from "@steam-monitor/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

/**
 * 调试接口：原样返回我们爬取物品页得到的原始数据（带你的 Cookie），
 * 用于和市场页显示值做同秒对比。
 */
export async function GET(req: NextRequest) {
  const appId = Number(req.nextUrl.searchParams.get("appid") ?? 1203220);
  const hash = req.nextUrl.searchParams.get("hash") ?? "";
  if (!hash) return NextResponse.json({ error: "缺少 hash 参数" }, { status: 400 });
  try {
    await applySettingsToSteam();
    const fetchedAt = Date.now();
    const page = await steam.getItemPage(appId, hash);
    const rawText: string = await (async () => {
      const res = await fetch(
        `https://steamcommunity.com/market/listings/${appId}/${encodeURIComponent(hash)}?l=schinese&country=CN`,
        {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          },
          signal: AbortSignal.timeout(20000),
        },
      );
      return res.text();
    })();
    const o = parseItemPageOrders(rawText);
    return NextResponse.json({
      appId,
      hash,
      fetchedAt,
      pageName: page.name,
      parsed: o
        ? {
            buyCount: o.buyCount,
            sellCount: o.sellCount,
            highestBuyFromList: o.highestBuy,
            lowestSellFromList: o.lowestSell,
            currency: o.currency,
            firstBuyLevels: o.buyOrders.slice(0, 10),
            firstSellLevels: o.sellOrders.slice(0, 10),
          }
        : null,
      rawAmtMaxBuyOrder: rawText.match(/amtMaxBuyOrder[^0-9]*(\d+)/)?.[1] ?? null,
      rawAmtMinSellOrder: rawText.match(/amtMinSellOrder[^0-9]*(\d+)/)?.[1] ?? null,
      rawBuyArrayHead: rawText.match(/rgCompactBuyOrders[^\[]*\[([0-9,\s]{0,80})/)?.[1] ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }
}
