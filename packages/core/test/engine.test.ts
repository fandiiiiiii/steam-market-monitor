import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectChanges,
  stateFingerprint,
  type EngineState,
  type Histogram,
  type ItemSnapshot,
  type MonitorItem,
} from "../src/index.ts";

function item(overrides: Partial<MonitorItem> = {}): MonitorItem {
  return {
    id: "item-1",
    appId: 1203220,
    marketHashName: "Star - Rainbow Flow(CN)",
    displayName: "谪星·绚妙虹流（国服）",
    enabled: true,
    watchSell: true,
    watchBuy: true,
    maxPrice: null,
    minBuyPrice: null,
    priceDropPct: null,
    snipedAlert: false,
    cooldownSec: 60,
    createdAt: 1,
    ...overrides,
  };
}

function snap(
  sellCount: number | null,
  sellPrice: number | null,
  histogram?: Histogram | null,
  at = 1000,
): ItemSnapshot {
  return {
    histogram: histogram ?? null,
    sellCount,
    sellPrice,
    fetchedAt: at,
  };
}

function hist(overrides: Partial<Histogram> = {}): Histogram {
  return {
    sellOrderCount: 2,
    buyOrderCount: 2,
    lowestSellOrder: 1000,
    highestBuyOrder: 800,
    sellGraph: [],
    buyGraph: [
      { price: 800, quantity: 2 },
      { price: 700, quantity: 1 },
    ],
    pricePrefix: "¥",
    ...overrides,
  };
}

describe("detectChanges", () => {
  it("首轮静默建立基线，不产生事件", () => {
    const { events, next } = detectChanges(null, snap(10, 1000, hist()), item());
    assert.deepEqual(events, []);
    assert.equal(next.initialized, true);
    assert.equal(next.lastSellCount, 10);
    assert.equal(next.lastSellPrice, 1000);
  });

  it("在售数量增加 → 新上架事件", () => {
    const prev = detectChanges(null, snap(10, 1000, hist()), item()).next;
    const { events } = detectChanges(prev, snap(11, 1000, hist()), item());
    assert.deepEqual(events.map((e) => e.type), ["new_listing"]);
    assert.ok(events[0].detail.includes("10 → 11"));
  });

  it("maxPrice 过滤新上架提醒（按当前最低价判断）", () => {
    const i = item({ maxPrice: 900 });
    const prev = detectChanges(null, snap(10, 1000, hist()), i).next;
    // 数量增加但最低价 1000 高于阈值 → 不提醒
    assert.deepEqual(detectChanges(prev, snap(11, 1000, hist()), i).events, []);
    // 最低价 850 ≤ 900 → 提醒
    const hit = detectChanges(prev, snap(11, 850, hist()), i);
    assert.deepEqual(hit.events.map((e) => e.type), ["new_listing"]);
  });

  it("watchSell=false 时不提醒新上架", () => {
    const prev = detectChanges(null, snap(10, 1000, hist()), item()).next;
    const { events } = detectChanges(prev, snap(11, 1000, hist()), item({ watchSell: false }));
    assert.deepEqual(events, []);
  });

  it("降价达标优先报降价，不重复报新上架", () => {
    const i = item({ priceDropPct: 5 });
    const prev = detectChanges(null, snap(10, 1000, hist()), i).next;
    // 数量+1 且价格降 10% → 只报 price_drop
    const big = detectChanges(prev, snap(11, 900, hist({ lowestSellOrder: 900 })), i);
    assert.deepEqual(big.events.map((e) => e.type), ["price_drop"]);
    assert.ok(big.events[0].detail.includes("900"));
    // 数量不变、价格降 3%（不达标）→ 无事件
    const small = detectChanges(prev, snap(10, 970, hist({ lowestSellOrder: 970 })), i);
    assert.deepEqual(small.events, []);
  });

  it("在售数量减少且最低价回升 → 被秒事件", () => {
    const i = item({ snipedAlert: true });
    const prev = detectChanges(null, snap(10, 1000, hist()), i).next;
    const { events } = detectChanges(prev, snap(9, 1100, hist({ lowestSellOrder: 1100 })), i);
    assert.deepEqual(events.map((e) => e.type), ["sniped"]);
    assert.ok(events[0].detail.includes("10 → 9"));
  });

  it("数量减少但最低价未回升 → 不报被秒（卖的是非最低价单）", () => {
    const i = item({ snipedAlert: true });
    const prev = detectChanges(null, snap(10, 1000, hist()), i).next;
    const { events } = detectChanges(prev, snap(9, 1000, hist()), i);
    assert.deepEqual(events, []);
  });

  it("数量减少且无在售（卖空）→ 被秒事件", () => {
    const i = item({ snipedAlert: true });
    const prev = detectChanges(null, snap(1, 1000, hist()), i).next;
    const { events } = detectChanges(prev, snap(0, null, hist()), i);
    assert.deepEqual(events.map((e) => e.type), ["sniped"]);
  });

  it("检测求购新增价位", () => {
    const prev = detectChanges(null, snap(10, 1000, hist()), item()).next;
    const h2 = hist({
      buyGraph: [
        { price: 800, quantity: 2 },
        { price: 700, quantity: 1 },
        { price: 850, quantity: 3 },
      ],
      highestBuyOrder: 850,
    });
    const { events } = detectChanges(prev, snap(10, 1000, h2), item());
    assert.deepEqual(events.map((e) => e.type), ["buy_order_change"]);
    assert.ok(events[0].detail.includes("850"));
  });

  it("检测求购数量增加与最高求购价上升", () => {
    const prev = detectChanges(null, snap(10, 1000, hist()), item()).next;
    const h2 = hist({ buyGraph: [{ price: 800, quantity: 5 }], highestBuyOrder: 900 });
    const { events } = detectChanges(prev, snap(10, 1000, h2), item());
    const e = events.find((x) => x.type === "buy_order_change");
    assert.ok(e);
    assert.ok(e!.detail.includes("数量增加"));
    assert.ok(e!.detail.includes("+3"));
    assert.ok(e!.detail.includes("900"));
  });

  it("检测最高求购价下降", () => {
    const prev = detectChanges(null, snap(10, 1000, hist()), item()).next;
    // 最高求购价 800 → 700（并移除 800 价位）
    const h2 = hist({ buyGraph: [{ price: 700, quantity: 1 }], highestBuyOrder: 700 });
    const { events } = detectChanges(prev, snap(10, 1000, h2), item());
    const e = events.find((x) => x.type === "buy_order_change");
    assert.ok(e);
    assert.ok(e!.detail.includes("最高求购价降至"));
    assert.ok(e!.detail.includes("700"));
  });

  it("minBuyPrice 过滤求购提醒", () => {
    const i = item({ minBuyPrice: 850 });
    const prev = detectChanges(null, snap(10, 1000, hist()), i).next;
    const h2 = hist({ buyGraph: [{ price: 800, quantity: 2 }, { price: 700, quantity: 5 }], highestBuyOrder: 900 });
    const { events } = detectChanges(prev, snap(10, 1000, h2), i);
    const e = events.find((x) => x.type === "buy_order_change");
    assert.ok(e);
    assert.ok(!e!.detail.includes("数量增加"));
  });

  it("watchBuy=false 时不检测求购", () => {
    const prev = detectChanges(null, snap(10, 1000, hist()), item()).next;
    const h2 = hist({ buyGraph: [{ price: 800, quantity: 2 }, { price: 850, quantity: 3 }] });
    const { events } = detectChanges(prev, snap(10, 1000, h2), item({ watchBuy: false }));
    assert.deepEqual(events, []);
  });

  it("histogram 缺失时不检测求购且不丢状态", () => {
    const prev = detectChanges(null, snap(10, 1000, hist()), item()).next;
    const { events, next } = detectChanges(prev, snap(11, 950, null), item());
    assert.deepEqual(events.map((e) => e.type), ["new_listing"]);
    assert.equal(next.buyFingerprint, prev.buyFingerprint);
  });

  it("状态指纹在平稳期保持稳定（供 runner 判断是否写回）", () => {
    const prev = detectChanges(null, snap(10, 1000, hist()), item()).next;
    const { next } = detectChanges(prev, snap(10, 1000, hist()), item());
    assert.equal(stateFingerprint(next), stateFingerprint({ ...prev, fp: null, lastSeenAt: 9999 }));
  });
});

describe("EngineState 兼容性", () => {
  it("旧版本状态（无新字段）可正常初始化", () => {
    const legacy = { initialized: true, seen: {}, lastMinPrice: 5 } as unknown as EngineState;
    const { events } = detectChanges(legacy, snap(3, 500, null), item());
    // 旧状态缺失 lastSellCount 等字段时按 null 处理，不应抛错
    assert.deepEqual(events, []);
  });
});
