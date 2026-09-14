import path from "node:path";
import { FileKV, Notifier, SteamClient, Store, runRound, type RoundSummary } from "@steam-monitor/core";

/**
 * 本地巡检模式（无云端时的替代方案；也用于开发调试）。
 * 运行：pnpm worker（循环）/ pnpm worker:once（单轮）
 * 说明：Steam 社区接口在国内网络不可达，请配合 HTTP_PROXY 代理使用（见 .env.example）。
 * 物品与设置在"数据文件"中维护；也可先用 Web 管理页（pnpm dev）配置后把 data/db.json 指过来。
 */

const once = process.argv.includes("--once");
const dataFile = process.env.DATA_FILE ?? path.join(process.cwd(), "data", "db.json");

const store = new Store(new FileKV(dataFile));
const steam = new SteamClient({
  currency: Number(process.env.STEAM_CURRENCY ?? 23),
  proxyUrl: process.env.HTTP_PROXY || process.env.HTTPS_PROXY,
  cookies: process.env.STEAM_COOKIE ?? "",
  logger: (m) => console.log(m),
});
const notifier = new Notifier();

async function ensureWebhook(): Promise<void> {
  const envKey = process.env.WECOM_WEBHOOK_KEY ?? "";
  if (!envKey) return;
  const s = await store.getSettings();
  if (!s.webhookKey) {
    s.webhookKey = envKey;
    await store.saveSettings(s);
    console.log("[worker] 已从环境变量载入企业微信 webhook key");
  }
}

async function tick(): Promise<void> {
  try {
    const summary: RoundSummary = await runRound({ store, steam, notifier, onLog: (m) => console.log(m) });
    if (summary.skipped) {
      console.log(`[worker] 本轮跳过：${summary.skipReason ?? ""}`);
    } else {
      console.log(`[worker] 巡检完成：检查 ${summary.itemsChecked}，失败 ${summary.itemsFailed}，推送 ${summary.pushed}`);
    }
    for (const e of summary.errors) console.error(`[worker] 错误：${e}`);
  } catch (e) {
    console.error("[worker] 巡检异常：", e);
  }
}

async function main(): Promise<void> {
  await ensureWebhook();
  const items = await store.getItems();
  console.log(
    `[worker] 已加载 ${items.filter((i) => i.enabled).length}/${items.length} 个启用物品（数据文件：${dataFile}）`,
  );
  if (once) {
    await tick();
    process.exit(0);
  }
  const intervalSec = Math.max(10, Number(process.env.POLL_INTERVAL_SEC ?? 60) || 60);
  console.log(`[worker] 开始循环巡检，每 ${intervalSec}s 一轮（Ctrl+C 退出）`);
  await tick();
  setInterval(() => void tick(), intervalSec * 1000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
