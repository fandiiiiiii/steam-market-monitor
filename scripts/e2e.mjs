// Web 应用 E2E 验证脚本
// 前置：node scripts/mock-servers.mjs 39991 39992 + 以 STEAM_BASE_URL/WECOM_BASE_URL/WECOM_WEBHOOK_KEY 启动 web（pnpm dev）
// 运行：node scripts/e2e.mjs [BASE] [MOCK]  （默认 http://127.0.0.1:3000 / http://127.0.0.1:39991）
const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const MOCK = process.argv[3] ?? "http://127.0.0.1:39991";

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ ${msg}`);
    process.exit(1);
  }
}

async function main() {
  // 0. 清理历史数据 + 重置 mock 市场
  const { items } = await (await fetch(`${BASE}/api/items`)).json();
  for (const i of items) {
    await fetch(`${BASE}/api/items/${i.id}`, { method: "DELETE" });
  }
  await fetch(`${MOCK}/__reset`, { method: "POST" });

  // 1. 首页可访问
  const page = await fetch(`${BASE}/`);
  assert(page.ok && (await page.text()).includes("Steam 市场监控"), "首页应可访问");
  console.log("[e2e] ✓ 首页 200");

  // 2. 健康接口
  const health = await (await fetch(`${BASE}/api/health`)).json();
  assert(health.itemsTotal === 0 && health.pollEnabled === true, "初始健康状态应为空列表+轮询开启");
  assert(health.webhookKeySet === true, "应已从环境变量载入 webhook key");
  console.log("[e2e] ✓ 健康接口正常（后端=" + health.backend + "）");

  // 3. 添加物品
  const created = await (
    await fetch(`${BASE}/api/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appId: 1203220,
        marketHashName: "Star - Dragon's Bane(Non-CN)",
        displayName: "长剑谪星·信手斩龙（国际服）",
      }),
    })
  ).json();
  assert(created.item && created.item.id, "添加物品应成功");
  const itemId = created.item.id;
  console.log("[e2e] ✓ 添加物品", itemId);

  // 4. 第一轮巡检（基线）
  const r1 = await (await fetch(`${BASE}/api/monitor`, { method: "POST" })).json();
  assert(r1.skipped === false && r1.itemsChecked === 1 && r1.itemsFailed === 0, `首轮应成功巡检，实际 ${JSON.stringify(r1)}`);
  assert(r1.pushed === 0, "首轮基线不应推送");
  console.log("[e2e] ✓ 首轮基线巡检");

  // 5. mock 市场出现新低价单
  await fetch(`${MOCK}/__new-listing`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ listingId: "1002", price: 950 }),
  });

  // 6. 第二轮巡检 → 应检测并推送
  const r2 = await (await fetch(`${BASE}/api/monitor`, { method: "POST" })).json();
  assert(r2.itemsFailed === 0, `第二轮不应失败：${JSON.stringify(r2)}`);
  assert(r2.pushed >= 1, `第二轮应推送，实际 ${JSON.stringify(r2)}`);
  console.log("[e2e] ✓ 第二轮巡检推送", r2.pushed, "条");

  // 7. 事件日志
  const events = await (await fetch(`${BASE}/api/events`)).json();
  assert(events.events.length >= 1, "事件日志应有记录");
  const types = events.events.map((e) => e.type);
  assert(types.includes("price_drop") || types.includes("new_listing"), `应含 price_drop/new_listing，实际 ${types}`);
  console.log("[e2e] ✓ 事件日志：", types.join(","));

  // 8. 设置接口（读写）
  const s0 = await (await fetch(`${BASE}/api/settings`)).json();
  assert(s0.settings.webhookKeySet === true, "设置应显示 webhook 已配置");
  const s1 = await (
    await fetch(`${BASE}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ globalCooldownSec: 120 }),
    })
  ).json();
  assert(s1.settings.globalCooldownSec === 120, "设置保存应生效");
  console.log("[e2e] ✓ 设置读写");

  // 9. 快照接口
  const snap = await (await fetch(`${BASE}/api/items/${itemId}/snapshot`)).json();
  assert(snap.snapshot && snap.snapshot.histogram.lowestSellOrder === 950, "快照应反映 mock 市场数据");
  console.log("[e2e] ✓ 行情快照（最低 ¥", snap.snapshot.histogram.lowestSellOrder, "）");

  console.log("\n✅ Web 应用 E2E 全部通过");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ E2E 失败：", e);
  process.exit(1);
});
