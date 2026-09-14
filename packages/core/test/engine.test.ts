import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectChanges,
  type EngineState,
  type Histogram,
  type ItemSnapshot,
  type MonitorItem,
} from "../src/index.ts";

function item(overrides: Partial<MonitorItem> = {}): MonitorItem {
  return {
    id: "item-1",
    appId: 1203220,
    marketHashName: "Star - Dragon's Bane(Non-CN)",
    displayName: "长剑谪星·信手斩龙（国际服）",
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
  listings: Array<[string, number]>,
  histogram?: Histogram | null,
  at = 1000,
): ItemSnapshot {
  return {
    histogram: histogram ?? null,
    listings: listings.map(([listingId, price]) => ({ listingId, price })),
    totalListings: listings.length,
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
    ...overrides,
  };
}

describe("detectChanges", () => {
  it("首轮静默建立基线，不产生事件", () => {
    const { events, next } = detectChanges(null, snap([["a", 1000], ["b", 1100]], hist()), item());
    assert.deepEqual(events, []);
    assert.equal(next.initialized, true);
    assert.equal(next.lastMinPrice, 1000);
    assert.equal(next.lastMinListingId, "a");
    assert.deepEqual(Object.keys(next.seen), ["a", "b"]);
  });

  it("检测新上架出售单", () => {
    const prev = detectChanges(null, snap([["a", 1000]], hist()), item()).next;
    const { events } = detectChanges(prev, snap([["a", 1000], ["b", 950]], hist()), item());
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "new_listing");
    assert.ok(events[0].detail.includes("950"));
  });

  it("maxPrice 过滤新上架提醒", () => {
    const prev = detectChanges(null, snap([["a", 1000]], hist()), item()).next;
    const withMax = item({ maxPrice: 900 });
    assert.deepEqual(detectChanges(prev, snap([["a", 1000], ["b", 950]], hist()), withMax).events, []);
    const hit = detectChanges(prev, snap([["a", 1000], ["b", 950], ["c", 850]], hist()), withMax);
    assert.equal(hit.events.length, 1);
    assert.ok(hit.events[0].detail.includes("850"));
  });

  it("watchSell=false 时不提醒新上架", () => {
    const prev = detectChanges(null, snap([["a", 1000]], hist()), item()).next;
    const { events } = detectChanges(prev, snap([["a", 1000], ["b", 950]], hist()), item({ watchSell: false }));
    assert.deepEqual(events, []);
  });

  it("降价达标才提醒，达标时优先报降价不重复报新上架", () => {
    const i = item({ priceDropPct: 5 });
    const prev = detectChanges(null, snap([["a", 1000]], hist()), i).next;
    // 降 10%（900）达标：仅报 price_drop，b 不重复计入新上架
    const big = detectChanges(prev, snap([["a", 1000], ["b", 900]], hist({ lowestSellOrder: 900 })), i);
    assert.deepEqual(big.events.map((e) => e.type), ["price_drop"]);
    assert.ok(big.events[0].detail.includes("900"));
    // 降 3%（970）不达标：按普通新上架报
    const small = detectChanges(prev, snap([["a", 1000], ["b", 970]], hist({ lowestSellOrder: 970 })), i);
    assert.deepEqual(small.events.map((e) => e.type), ["new_listing"]);
  });

  it("降价达标且同时有其他新单时，两种事件分别报告", () => {
    const i = item({ priceDropPct: 5 });
    const prev = detectChanges(null, snap([["a", 1000]], hist()), i).next;
    const { events } = detectChanges(
      prev,
      snap([["a", 1000], ["b", 900], ["c", 1050]], hist({ lowestSellOrder: 900 })),
      i,
    );
    assert.deepEqual(events.map((e) => e.type), ["new_listing", "price_drop"]);
    const nl = events.find((e) => e.type === "new_listing")!;
    assert.ok(nl.detail.includes("1 条"));
    assert.ok(nl.detail.includes("1,050.00"));
  });

  it("同 listingId 出现两次不会重复报新上架", () => {
    const prev = detectChanges(null, snap([["a", 1000]], hist()), item()).next;
    const { events, next } = detectChanges(prev, snap([["a", 1000]], hist()), item());
    assert.deepEqual(events, []);
    assert.equal(next.seen["a"].price, 1000);
  });

  it("检测最低价被秒", () => {
    const i = item({ snipedAlert: true });
    const prev = detectChanges(null, snap([["a", 1000], ["b", 1100]], hist()), i).next;
    const { events } = detectChanges(prev, snap([["b", 1100]], hist({ lowestSellOrder: 1100 })), i);
    assert.deepEqual(events.map((e) => e.type), ["sniped"]);
    assert.ok(events[0].detail.includes("1,000.00"));
  });

  it("最低价消失但新低出现时不报被秒", () => {
    const i = item({ snipedAlert: true });
    const prev = detectChanges(null, snap([["a", 1000]], hist()), i).next;
    const { events } = detectChanges(prev, snap([["b", 950]], hist({ lowestSellOrder: 950 })), i);
    assert.deepEqual(events.map((e) => e.type), ["new_listing"]);
  });

  it("检测求购新增价位", () => {
    const prev = detectChanges(null, snap([["a", 1000]], hist()), item()).next;
    const h2 = hist({
      buyGraph: [
        { price: 800, quantity: 2 },
        { price: 700, quantity: 1 },
        { price: 850, quantity: 3 },
      ],
      highestBuyOrder: 850,
    });
    const { events } = detectChanges(prev, snap([["a", 1000]], h2), item());
    assert.deepEqual(events.map((e) => e.type), ["buy_order_change"]);
    assert.ok(events[0].detail.includes("850"));
  });

  it("检测求购数量增加与最高求购价上升", () => {
    const prev = detectChanges(null, snap([["a", 1000]], hist()), item()).next;
    const h2 = hist({ buyGraph: [{ price: 800, quantity: 5 }], highestBuyOrder: 900 });
    const { events } = detectChanges(prev, snap([["a", 1000]], h2), item());
    const e = events.find((x) => x.type === "buy_order_change");
    assert.ok(e);
    assert.ok(e!.detail.includes("数量增加"));
    assert.ok(e!.detail.includes("+3"));
    assert.ok(e!.detail.includes("900"));
  });

  it("minBuyPrice 过滤求购提醒", () => {
    const i = item({ minBuyPrice: 850 });
    const prev = detectChanges(null, snap([["a", 1000]], hist()), i).next;
    const h2 = hist({ buyGraph: [{ price: 800, quantity: 2 }, { price: 700, quantity: 5 }], highestBuyOrder: 900 });
    const { events } = detectChanges(prev, snap([["a", 1000]], h2), i);
    const e = events.find((x) => x.type === "buy_order_change");
    assert.ok(e);
    assert.ok(!e!.detail.includes("数量增加"));
  });

  it("watchBuy=false 时不检测求购", () => {
    const prev = detectChanges(null, snap([["a", 1000]], hist()), item()).next;
    const h2 = hist({ buyGraph: [{ price: 800, quantity: 2 }, { price: 850, quantity: 3 }] });
    const { events } = detectChanges(prev, snap([["a", 1000]], h2), item({ watchBuy: false }));
    assert.deepEqual(events, []);
  });

  it("histogram 缺失时不检测求购且不丢状态", () => {
    const prev = detectChanges(null, snap([["a", 1000]], hist()), item()).next;
    const { events, next } = detectChanges(prev, snap([["a", 1000], ["b", 950]], null), item());
    assert.deepEqual(events.map((e) => e.type), ["new_listing"]);
    assert.equal(next.buyFingerprint, prev.buyFingerprint);
  });

  it("去重集合超限时淘汰最旧记录", () => {
    const many: Record<string, { price: number; at: number }> = {};
    for (let i = 0; i < 500; i++) many[`old-${i}`] = { price: 1000 + i, at: 1 };
    const prev: EngineState = {
      initialized: true,
      seen: many,
      lastMinPrice: 1000,
      lastMinListingId: "old-0",
      highestBuy: null,
      buyGraph: [],
      buyFingerprint: "[]",
      lastSeenAt: 2,
    };
    const { next } = detectChanges(prev, snap([["new-1", 500], ["new-2", 600]], null, 5000), item());
    assert.equal(Object.keys(next.seen).length, 500);
    assert.ok(next.seen["new-1"]);
    assert.equal(next.seen["old-0"], undefined);
  });
});
