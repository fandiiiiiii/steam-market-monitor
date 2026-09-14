import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FileKV,
  Notifier,
  SteamClient,
  Store,
  runRound,
  type MonitorItem,
} from "@steam-monitor/core";

/**
 * 全链路冒烟测试（不依赖真实 Steam / 企业微信，也不依赖外部网络）：
 * 1. 进程内起 mock Steam 服务器与 mock 企业微信服务器
 * 2. 第一轮巡检建立基线（不推送）
 * 3. mock 数据里出现新上架（数量+1、最低价下降）+ 求购变化
 * 4. 第二轮巡检应检测到事件并推送 markdown 到 mock 企业微信
 * 运行：pnpm smoke
 */

const APP_ID = 1203220;
const HASH = "Star - Dragon's Bane(Non-CN)";

const state = {
  count: 1,
  price: 1000,
  buyGraph: [["800.00", 2, "2 orders @ ¥800.00"]],
  sellGraph: [["1000.00", 1, "1 order @ ¥1000.00"]],
};

function mockSteamServer(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      res.setHeader("content-type", "application/json; charset=utf-8");
      if (url.pathname.startsWith("/market/listings/")) {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(`<html><head><script>Market_LoadOrderSpread( 123456 );</script></head><body></body></html>`);
        return;
      }
      if (url.pathname === "/market/itemordershistogram") {
        res.end(
          JSON.stringify({
            success: 1,
            sell_order_count: String(state.sellGraph.reduce((a, p) => a + Number(p[1]), 0)),
            buy_order_count: String(state.buyGraph.reduce((a, p) => a + Number(p[1]), 0)),
            lowest_sell_order: state.sellGraph.length ? state.sellGraph[0][0] : "",
            highest_buy_order: state.buyGraph.length ? state.buyGraph[0][0] : "",
            sell_order_graph: state.sellGraph,
            buy_order_graph: state.buyGraph,
          }),
        );
        return;
      }
      if (url.pathname.startsWith("/market/search/render")) {
        res.end(
          JSON.stringify({
            success: true,
            start: 0,
            pagesize: 10,
            total_count: 1,
            searchdata: { query: HASH, total_count: 1 },
            results: [
              {
                name: HASH,
                hash_name: HASH,
                sell_listings: state.count,
                sell_price: Math.round(state.price * 100),
                app_icon: "https://example.com/icon.jpg",
                app_name: "永劫无间",
              },
            ],
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function mockWecomServer(received: string[]): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push(body);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ errcode: 0, errmsg: "ok" }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function portOf(server: Server): number {
  const addr = server.address();
  if (addr && typeof addr === "object") return addr.port;
  throw new Error("server not listening");
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(tmpdir(), "sm-monitor-smoke-"));
  const item: MonitorItem = {
    id: "item-1",
    appId: APP_ID,
    marketHashName: HASH,
    displayName: "长剑谪星·信手斩龙（国际服）",
    enabled: true,
    watchSell: true,
    watchBuy: true,
    maxPrice: null,
    minBuyPrice: null,
    priceDropPct: 5,
    snipedAlert: true,
    cooldownSec: 60,
    nameId: null,
    createdAt: Date.now(),
  };

  const steamSrv = await mockSteamServer();
  const received: string[] = [];
  const wecomSrv = await mockWecomServer(received);

  try {
    const store = new Store(new FileKV(path.join(tmp, "db.json")));
    await store.saveItems([item]);
    await store.saveSettings({
      webhookKey: "test-key",
      pollEnabled: true,
      globalCooldownSec: 60,
      quietHoursStart: null,
      quietHoursEnd: null,
      usdToCnyRate: 1,
    });
    const steam = new SteamClient({ baseUrl: `http://127.0.0.1:${portOf(steamSrv)}`, minIntervalMs: 0 });
    const notifier = new Notifier({ baseUrl: `http://127.0.0.1:${portOf(wecomSrv)}` });

    // 第 1 轮：基线（静默）
    const r1 = await runRound({ store, steam, notifier, onLog: (m) => console.log(`[smoke] ${m}`) });
    assert(r1.pushed === 0, `首轮应不推送，实际推送 ${r1.pushed}`);
    assert(received.length === 0, "首轮不应有任何 webhook 调用");

    // 模拟市场变化：新上架（数量+1、最低价 950）+ 求购新价位 850 / 800 数量+1
    state.count = 2;
    state.price = 950;
    state.sellGraph = [
      ["950.00", 1, "1 order @ ¥950.00"],
      ["1000.00", 1, "1 order @ ¥1000.00"],
    ];
    state.buyGraph = [
      ["850.00", 1, "1 order @ ¥850.00"],
      ["800.00", 3, "3 orders @ ¥800.00"],
    ];

    const r2 = await runRound({ store, steam, notifier, onLog: (m) => console.log(`[smoke] ${m}`) });
    const events = await store.getEvents("item-1");
    console.log(`[smoke] 第二轮事件：${events.map((e) => `${e.type}(${e.title})`).join(" | ")}`);
    assert(r2.pushed >= 1, `第二轮应至少推送 1 条，实际 ${r2.pushed}`);
    assert(received.length >= 1, `webhook 应收到消息，实际 ${received.length}`);
    const body = JSON.parse(received[0]);
    assert(body.msgtype === "markdown", "消息类型应为 markdown");
    assert(body.markdown.content.includes("950"), "消息应包含新低价格 950");
    assert(body.markdown.content.includes(HASH) || body.markdown.content.includes(item.displayName), "消息应包含物品名");

    const types = events.map((e) => e.type);
    // 5% 降价达标时引擎按设计以 price_drop 优先（不重复报 new_listing）
    assert(
      types.includes("new_listing") || types.includes("price_drop"),
      `事件应包含 new_listing 或 price_drop，实际 ${types.join(",")}`,
    );
    assert(types.includes("buy_order_change"), `事件应包含 buy_order_change，实际 ${types.join(",")}`);

    console.log("\n✅ 冒烟测试通过：基线静默 → 新上架/降价/求购变化检测 → 企业微信推送，全链路正常");
    console.log(`   第二轮事件：${types.join(", ")}`);
    console.log(`   推送内容预览：\n${body.markdown.content.split("\n").slice(0, 6).join("\n")}`);
  } finally {
    steamSrv.closeAllConnections?.();
    wecomSrv.closeAllConnections?.();
    steamSrv.close();
    wecomSrv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`❌ 冒烟测试失败：${msg}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("❌ 冒烟测试异常：", e);
  process.exit(1);
});
