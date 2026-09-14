import { NextResponse, type NextRequest } from "next/server";
import { adminAuthorized } from "@/lib/auth";
import { notifier, store } from "@/lib/singletons";
import { buildItemMessage, errMsg, normalizeWebhookKey, type DetectEvent, type MonitorItem } from "@steam-monitor/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

/**
 * 发送测试消息：
 * - 默认：简单测试卡片
 * - mode=event：模拟一条真实的"新上架"告警（验证推送链路与消息格式）
 * - 可传临时 key 测试未保存的机器人
 */
export async function POST(req: NextRequest) {
  if (!adminAuthorized(req)) return NextResponse.json({ error: "未授权" }, { status: 401 });
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // 允许无请求体
  }
  const settings = await store.getSettings();
  const rawKey = (typeof body?.key === "string" && body.key.trim()) || settings.webhookKey;
  const key = normalizeWebhookKey(rawKey);
  if (!key) return NextResponse.json({ error: "尚未配置企业微信 webhook key" }, { status: 400 });
  try {
    if (body?.mode === "event") {
      const fakeItem: MonitorItem = {
        id: "test",
        appId: 1203220,
        marketHashName: "Star - Soulguider(CN)",
        displayName: "谪星·引魂姬（国服）",
        enabled: true,
        watchSell: true,
        watchBuy: true,
        maxPrice: null,
        minBuyPrice: null,
        priceDropPct: null,
        snipedAlert: false,
        cooldownSec: 60,
        createdAt: Date.now(),
      };
      const fakeEvents: DetectEvent[] = [
        {
          itemId: "test",
          type: "new_listing",
          title: "卖家新上架",
          detail: "在售数量 10 → 11，当前最低 ¥7,000.00（模拟数据）",
        },
        {
          itemId: "test",
          type: "buy_order_change",
          title: "求购订单变化",
          detail: "最高求购价升至 ¥5,984.10；新增求购价位：¥5,642.13×1（模拟数据）",
        },
      ];
      const msg = buildItemMessage(fakeItem, fakeEvents, Date.now());
      await notifier.send(key, msg);
      return NextResponse.json({ ok: true, mode: "event" });
    }
    const ok = await notifier.sendTest(key);
    return NextResponse.json({ ok });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }
}
