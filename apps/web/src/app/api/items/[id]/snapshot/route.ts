import { NextResponse, type NextRequest } from "next/server";
import { steam, store } from "@/lib/singletons";
import { errMsg } from "@steam-monitor/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type Ctx = { params: { id: string } };

/** 实时抓取物品行情快照（页面"刷新行情"用） */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const items = await store.getItems();
  const item = items.find((i) => i.id === ctx.params.id);
  if (!item) return NextResponse.json({ error: "物品不存在" }, { status: 404 });
  try {
    const snap = await steam.snapshot(item);
    const settings = await store.getSettings();
    // 与 runner 保持一致：搜索价格是美元，按汇率换算为人民币
    const sellPrice =
      snap.sellPrice != null ? Math.round(snap.sellPrice * settings.usdToCnyRate * 100) / 100 : null;
    return NextResponse.json({
      snapshot: {
        histogram: snap.histogram,
        sellCount: snap.sellCount,
        sellPrice,
        fetchedAt: snap.fetchedAt,
        nameId: snap.nameId,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }
}
