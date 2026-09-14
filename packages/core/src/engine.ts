import type { DetectEvent, EngineState, HistogramPoint, ItemSnapshot, MonitorItem } from "./types.ts";
import { fmtPrice } from "./util.ts";

function buyFingerprint(graph: HistogramPoint[]): string {
  return JSON.stringify(graph.map((p) => [p.price, p.quantity]));
}

export function initState(): EngineState {
  return {
    initialized: false,
    lastSellCount: null,
    lastSellPrice: null,
    highestBuy: null,
    buyGraph: [],
    buyFingerprint: null,
    lastSeenAt: 0,
  };
}

/** 状态稳定指纹（排除时间戳字段），用于判断是否需要写回存储 */
export function stateFingerprint(state: EngineState): string {
  return JSON.stringify([
    state.initialized,
    state.lastSellCount,
    state.lastSellPrice,
    state.highestBuy,
    state.buyFingerprint,
  ]);
}

/**
 * 对比新旧快照，产出检测事件。
 * 基于 Steam 官方搜索接口的聚合数据（在售数量 + 最低售价）：
 * - 首次运行只做基线记录，不产生事件；
 * - 新上架：在售数量增加（受 maxPrice 过滤，以当前最低价判断）；
 * - 降价：最低售价下降且降幅达标（达标时优先报降价，不重复报新上架）；
 * - 被秒：在售数量减少且最低价回升（原最低价大概率被买走）；
 * - 求购变化：柱状图指纹变化（新增价位 / 数量增加 / 最高求购价上升或下降，受 minBuyPrice 过滤）。
 */
export function detectChanges(
  prev: EngineState | null,
  snap: ItemSnapshot,
  item: MonitorItem,
): { events: DetectEvent[]; next: EngineState } {
  const events: DetectEvent[] = [];
  const next: EngineState = prev ? { ...prev } : initState();
  const at = snap.fetchedAt;
  const count = snap.sellCount;
  const price = snap.sellPrice;

  // 首次运行：静默建立基线
  if (!next.initialized) {
    next.lastSellCount = count;
    next.lastSellPrice = price;
    if (snap.histogram) {
      next.buyGraph = snap.histogram.buyGraph;
      next.buyFingerprint = buyFingerprint(snap.histogram.buyGraph);
      next.highestBuy = snap.histogram.highestBuyOrder;
    }
    next.initialized = true;
    next.lastSeenAt = at;
    return { events, next };
  }

  if (!prev) {
    return { events, next };
  }

  const prevCount = prev.lastSellCount;
  const prevPrice = prev.lastSellPrice;

  // ---- 卖家上架 / 降价 / 被秒 ----
  const countUp = count != null && prevCount != null && count > prevCount;
  const countDown = count != null && prevCount != null && count < prevCount;

  const dropQualifies =
    item.priceDropPct != null &&
    item.priceDropPct > 0 &&
    price != null &&
    prevPrice != null &&
    price < prevPrice &&
    ((prevPrice - price) / prevPrice) * 100 >= item.priceDropPct;

  if (item.watchSell && countUp && !dropQualifies) {
    const maxPrice = item.maxPrice ?? null;
    if (maxPrice == null || (price != null && price <= maxPrice)) {
      events.push({
        itemId: item.id,
        type: "new_listing",
        title: "卖家新上架",
        detail:
          `在售数量 ${prevCount} → ${count}` +
          (price != null ? `，当前最低 ¥${fmtPrice(price)}` : "") +
          (maxPrice != null ? `（提醒阈值 ≤ ¥${fmtPrice(maxPrice)}）` : ""),
      });
    }
  }

  if (dropQualifies && price != null && prevPrice != null) {
    const pct = ((prevPrice - price) / prevPrice) * 100;
    events.push({
      itemId: item.id,
      type: "price_drop",
      title: "最低售价下降",
      detail: `¥${fmtPrice(prevPrice)} → ¥${fmtPrice(price)}（-${pct.toFixed(1)}%），在售 ${count ?? "-"} 件`,
    });
  }

  if (item.snipedAlert && countDown && (price == null || (prevPrice != null && price > prevPrice))) {
    events.push({
      itemId: item.id,
      type: "sniped",
      title: "最低价出售单被买走",
      detail:
        `在售数量 ${prevCount} → ${count}` +
        (price != null && prevPrice != null ? `，最低价 ¥${fmtPrice(prevPrice)} → ¥${fmtPrice(price)}` : ""),
    });
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
      } else if (hb != null && prev.highestBuy != null && hb < prev.highestBuy && (minB == null || hb >= minB)) {
        parts.push(`最高求购价降至 ¥${fmtPrice(hb)}`);
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
  next.lastSellCount = count;
  next.lastSellPrice = price;
  next.lastSeenAt = at;

  return { events, next };
}
