import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildItemMessage,
  type DetectEvent,
  type ItemSnapshot,
  MemoryKV,
  type MonitorItem,
  runRound,
  Store,
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

const SETTINGS = {
  webhookKey: "k",
  pollEnabled: true,
  globalCooldownSec: 60,
  quietHoursStart: null,
  quietHoursEnd: null,
};

function snapAt(sellCount: number, sellPrice: number, at: number): ItemSnapshot {
  return { histogram: null, sellCount, sellPrice, fetchedAt: at };
}

function makeSend() {
  const calls: Array<[string, string]> = [];
  const send = async (key: string, msg: string) => {
    calls.push([key, msg]);
    return true;
  };
  return { send, calls };
}

describe("runRound", () => {
  it("首轮基线不推送，次轮新上架推送并记录事件", async () => {
    const store = new Store(new MemoryKV());
    await store.saveItems([item()]);
    await store.saveSettings(SETTINGS);
    let clock = 10_000;
    const snapshots: ItemSnapshot[] = [snapAt(1, 1000, clock), snapAt(2, 950, clock + 60_000)];
    const steam = {
      snapshot: async () => snapshots.shift() ?? snapAt(1, 1000, clock),
    };
    const { send, calls } = makeSend();

    const now = () => clock;
    const r1 = await runRound({ store, steam, notifier: { send }, now });
    assert.equal(r1.pushed, 0);
    clock += 61_000;
    const r2 = await runRound({ store, steam, notifier: { send }, now });
    assert.equal(r2.pushed, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "k");
    assert.ok(calls[0][1].includes("新上架"));
    assert.ok(calls[0][1].includes("950"));

    const events = await store.getEvents("item-1");
    assert.equal(events.length, 1);
    assert.equal(events[0].pushed, true);
  });

  it("冷却期内同类型事件不重复推送", async () => {
    const store = new Store(new MemoryKV());
    await store.saveItems([item()]);
    await store.saveSettings(SETTINGS);
    let clock = 10_000;
    const snapshots: ItemSnapshot[] = [
      snapAt(1, 1000, clock),
      snapAt(2, 950, clock + 30_000),
      snapAt(3, 900, clock + 60_000),
    ];
    const steam = { snapshot: async () => snapshots.shift() ?? snapAt(1, 1000, clock) };
    const { send, calls } = makeSend();
    const now = () => clock;
    await runRound({ store, steam, notifier: { send }, now });
    clock += 31_000;
    await runRound({ store, steam, notifier: { send }, now });
    clock += 62_000; // 距首次推送 93s，超过 60s 冷却
    await runRound({ store, steam, notifier: { send }, now });
    assert.equal(calls.length, 2);
  });

  it("免打扰时段按北京时间计算（不受服务器时区影响）", async () => {
    const store = new Store(new MemoryKV());
    await store.saveItems([item()]);
    await store.saveSettings({
      ...SETTINGS,
      quietHoursStart: "23:00",
      quietHoursEnd: "08:00",
    });
    const steam = { snapshot: async () => snapAt(1, 1000, 1000) };
    const { send } = makeSend();
    // 用 UTC 时间构造“北京时间 23:30”（= UTC 15:30），验证按北京时间进入免打扰
    const utc = Date.UTC(2026, 0, 1, 15, 30, 0);
    const r = await runRound({ store, steam, notifier: { send }, now: () => utc });
    assert.equal(r.skipped, true);
    assert.equal(r.skipReason, "处于免打扰时段");
  });

  it("pollEnabled=false 时跳过且不调用接口", async () => {
    const store = new Store(new MemoryKV());
    await store.saveItems([item()]);
    await store.saveSettings({ ...SETTINGS, pollEnabled: false });
    let called = 0;
    const steam = { snapshot: async () => (called++, snapAt(1, 1000, 1000)) };
    const { send } = makeSend();
    const r = await runRound({ store, steam, notifier: { send }, now: () => 1000 });
    assert.equal(r.skipped, true);
    assert.equal(called, 0);
  });

  it("连续 5 轮全部失败后推送监控异常告警，恢复后推送恢复", async () => {
    const store = new Store(new MemoryKV());
    await store.saveItems([item()]);
    await store.saveSettings(SETTINGS);
    let clock = 10_000;
    let failing = true;
    const steam = {
      snapshot: async () => {
        if (failing) throw new Error("Steam 超时");
        return snapAt(1, 1000, clock);
      },
    };
    const { send, calls } = makeSend();
    const now = () => clock;
    for (let i = 0; i < 5; i++) {
      await runRound({ store, steam, notifier: { send }, now });
      clock += 61_000;
    }
    assert.equal(calls.filter(([, m]) => m.includes("监控连续失败")).length, 1);
    failing = false;
    await runRound({ store, steam, notifier: { send }, now });
    assert.ok(calls.some(([, m]) => m.includes("监控已恢复")));
  });
});

describe("buildItemMessage", () => {
  it("超长内容按字节截断到企业微信上限内", () => {
    const events: DetectEvent[] = [
      { itemId: "x", type: "buy_order_change", title: "求购订单变化", detail: "¥" + "9".repeat(8000) + ".00 × 5" },
    ];
    const msg = buildItemMessage(item(), events, Date.now());
    assert.ok(Buffer.byteLength(msg, "utf8") <= 4096);
  });
});
