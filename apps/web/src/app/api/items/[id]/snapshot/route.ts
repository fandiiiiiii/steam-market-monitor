import { NextResponse, type NextRequest } from "next/server";
import { applySettingsToSteam, steam, store } from "@/lib/singletons";
import { currencySymbol, errMsg, getUsdRate } from "@steam-monitor/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type Ctx = { params: { id: string } };

/** 实时抓取物品行情快照（页面"刷新行情"用），价格按用户设置的币种换算 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const items = await store.getItems();
  const item = items.find((i) => i.id === ctx.params.id);
  if (!item) return NextResponse.json({ error: "物品不存在" }, { status: 404 });
  try {
    await applySettingsToSteam();
    const snap = await steam.snapshot(item);
    const settings = await store.getSettings();
    const symbol = currencySymbol(settings.currency);
    // 与 runner 一致：仅当原始币种为美元时按自动汇率换算
    const rate = await getUsdRate(store, settings.currency);
    const pc = snap.sellPriceCurrency ?? "USD";
    const conv = (n: number | null) =>
      n == null ? n : pc !== settings.currency && pc === "USD" ? Math.round(n * rate * 100) / 100 : n;
    if (snap.histogram && snap.histogram.pricePrefix === "$") {
      snap.histogram.lowestSellOrder = conv(snap.histogram.lowestSellOrder);
      snap.histogram.highestBuyOrder = conv(snap.histogram.highestBuyOrder);
      snap.histogram.sellGraph = snap.histogram.sellGraph.map((p) => ({ ...p, price: conv(p.price) ?? 0 }));
      snap.histogram.buyGraph = snap.histogram.buyGraph.map((p) => ({ ...p, price: conv(p.price) ?? 0 }));
      snap.histogram.pricePrefix = symbol;
    }
    return NextResponse.json({
      snapshot: {
        histogram: snap.histogram,
        sellCount: snap.sellCount,
        sellPrice: conv(snap.sellPrice),
        fetchedAt: snap.fetchedAt,
        nameId: snap.nameId,
      },
      currencySymbol: symbol,
      currency: settings.currency,
    });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }
}
