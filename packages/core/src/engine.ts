import type { DetectEvent, EngineState, HistogramPoint, ItemSnapshot, MonitorItem, SellListing } from "./types.ts";
import { fmtPrice } from "./util.ts";

/** 去重集合上限，超过后淘汰最久未见过的 listing */
const SEEN_CAP = 500;

export function initState(): EngineState {
  return {
    initialized: false,
    seen: {},
    lastMinPrice: null,
    lastMinListingId: null,
    highestBuy: null,
    buyGraph: [],
    buyFingerprint: null,
    lastSeenAt: 0,
  };
}

function buyFingerprint(graph: HistogramPoint[]): string {
  return JSON.stringify(graph.map((p) => [p.price, p.quantity]));
}

function minListing(listings: SellListing[]): SellListing | undefined {
  let best: SellListing | undefined;
  for (const l of listings) {
    if (!best || l.price < best.price) best = l;
  }
  return best;
}

function pruneSeen(seen: Record<string, { price: number; at: number }>): void {
  const entries = Object.entries(seen);
  if (entries.length <= SEEN_CAP) return;
  entries.sort((a, b) => a[1].at - b[1].at);
  for (const [id] of entries.slice(0, entries.length - SEEN_CAP)) {
    delete seen[id];
  }
}

/**
 * 对比新旧快照，产出检测事件。
 * - 首次运行只做基线记录，不产生事件；
 * - 新出售单：listingId 未见过（受 maxPrice 过滤）；
 * - 降价：最低售价下降且降幅达标（Steam 出售单价格不可改，新低必然来自新上架单；
 *   达标时以"降价"事件优先报告，并把该条从"新上架"清单剔除，避免重复提醒）；
 * - 被秒：上一次的最低价格出售单消失且最低价回升；
 * - 求购变化：柱状图指纹变化（新增价位 / 数量增加 / 最高求购价上升，受 minBuyPrice 过滤）。
 */
export function detectChanges(
  prev: EngineState | null,
  snap: ItemSnapshot,
  item: MonitorItem,
): { events: DetectEvent[]; next: EngineState } {
  const events: DetectEvent[] = [];
  const next: EngineState = prev
    ? { ...prev, seen: { ...prev.seen } }
    : initState();
  const at = snap.fetchedAt;
  const listings = snap.listings ?? [];
  const knownIds = new Set(Object.keys(next.seen));

  // 首次运行：静默建立基线
  if (!next.initialized) {
    for (const l of listings) next.seen[l.listingId] = { price: l.price, at };
    const min = minListing(listings);
    next.lastMinPrice = min?.price ?? null;
    next.lastMinListingId = min?.listingId ?? null;
    if (snap.histogram) {
      next.buyGraph = snap.histogram.buyGraph;
      next.buyFingerprint = buyFingerprint(snap.histogram.buyGraph);
      next.highestBuy = snap.histogram.highestBuyOrder;
    }
    next.initialized = true;
    next.lastSeenAt = at;
    return { events, next };
  }

  // 走到这里说明已初始化过（initialized 为 true 仅当 prev 存在）
  if (!prev) {
    return { events, next };
  }

  // ---- 卖家上架 / 降价 / 被秒 ----
  const newListings = listings.filter((l) => !knownIds.has(l.listingId));
  const min = minListing(listings);
  const curMinPrice = min?.price ?? null;
  const newMinIsNewListing = !!min && newListings.some((l) => l.listingId === min.listingId);

  const dropQualifies =
    item.priceDropPct != null &&
    item.priceDropPct > 0 &&
    prev.lastMinPrice != null &&
    curMinPrice != null &&
    curMinPrice < prev.lastMinPrice &&
    ((prev.lastMinPrice - curMinPrice) / prev.lastMinPrice) * 100 >= item.priceDropPct;

  if (item.watchSell && newListings.length > 0) {
    const maxPrice = item.maxPrice ?? null;
    let hit = newListings.filter((l) => maxPrice == null || l.price <= maxPrice);
    // 降价事件优先：达标时从"新上架"清单中剔除这条造成新低的单
    if (dropQualifies && newMinIsNewListing && min) {
      hit = hit.filter((l) => l.listingId !== min.listingId);
    }
    if (hit.length > 0) {
      const cheapest = [...hit].sort((a, b) => a.price - b.price)[0];
      events.push({
        itemId: item.id,
        type: "new_listing",
        title: `新上架 ${hit.length} 条出售单`,
        detail: `新单最低 ¥${fmtPrice(cheapest.price)}，共 ${hit.length} 条` +
          (maxPrice != null ? `（提醒阈值 ≤ ¥${fmtPrice(maxPrice)}）` : ""),
      });
    }
  }

  if (dropQualifies && prev.lastMinPrice != null && curMinPrice != null) {
    const pct = ((prev.lastMinPrice - curMinPrice) / prev.lastMinPrice) * 100;
    events.push({
      itemId: item.id,
      type: "price_drop",
      title: "最低售价下降",
      detail: `¥${fmtPrice(prev.lastMinPrice)} → ¥${fmtPrice(curMinPrice)}（-${pct.toFixed(1)}%）`,
    });
  }

  if (item.snipedAlert && prev.lastMinListingId != null && prev.lastMinPrice != null) {
    const prevMinStill = listings.some((l) => l.listingId === prev.lastMinListingId);
    if (!prevMinStill && (curMinPrice == null || curMinPrice > prev.lastMinPrice)) {
      events.push({
        itemId: item.id,
        type: "sniped",
        title: "最低价出售单已消失",
        detail: `原最低 ¥${fmtPrice(prev.lastMinPrice)} 已不在（可能被买走）` +
          (curMinPrice != null ? `，当前最低 ¥${fmtPrice(curMinPrice)}` : "，当前无在售"),
      });
    }
  }

  // ---- 求购变化 ----
  if (item.watchBuy && snap.histogram) {
    const graph = snap.histogram.buyGraph;
    const fp = buyFingerprint(graph);
    if (prev.buyFingerprint != null && fp !== prev.buyFingerprint) {
      const prevMap = new Map(prev.buyGraph.map((p) => [p.price, p.quantity]));
      const minB = item.minBuyPrice ?? null;
      const newPts = graph.filter((p) => !prevMap.has(p.price) && (minB == null || p.price >= minB));
      const incPts = graph.filter(
        (p) => prevMap.has(p.price) && p.quantity > (prevMap.get(p.price) ?? 0) && (minB == null || p.price >= minB),
      );
      const parts: string[] = [];
      if (newPts.length > 0) {
        parts.push(`新增求购价位：${newPts.map((p) => `¥${fmtPrice(p.price)}×${p.quantity}`).join("、")}`);
      }
      if (incPts.length > 0) {
        parts.push(
          `求购数量增加：${incPts
            .map((p) => `¥${fmtPrice(p.price)} +${p.quantity - (prevMap.get(p.price) ?? 0)}`)
            .join("、")}`,
        );
      }
      const hb = snap.histogram.highestBuyOrder;
      if (hb != null && prev.highestBuy != null && hb > prev.highestBuy) {
        parts.push(`最高求购价升至 ¥${fmtPrice(hb)}`);
      }
      if (parts.length > 0) {
        events.push({
          itemId: item.id,
          type: "buy_order_change",
          title: "求购订单变化",
          detail: parts.join("；"),
        });
      }
    }
    next.buyGraph = graph;
    next.buyFingerprint = fp;
    next.highestBuy = snap.histogram.highestBuyOrder ?? prev.highestBuy;
  }

  // ---- 状态更新 ----
  for (const l of listings) next.seen[l.listingId] = { price: l.price, at };
  pruneSeen(next.seen);
  next.lastMinPrice = curMinPrice;
  next.lastMinListingId = min?.listingId ?? null;
  next.lastSeenAt = at;

  return { events, next };
}
