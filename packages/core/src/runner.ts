import type { DetectEvent, EventRecord, EventType, MonitorItem, RoundSummary, Settings } from "./types.ts";
import { detectChanges } from "./engine.ts";
import type { Notifier } from "./notifier.ts";
import type { SteamClient } from "./steam/client.ts";
import type { Store } from "./storage/store.ts";
import { buildItemMessage, buildSystemMessage } from "./templates.ts";
import { errMsg, nowTs, timePartsInZone } from "./util.ts";

export interface RunnerDeps {
  store: Store;
  steam: Pick<SteamClient, "snapshot">;
  notifier: Pick<Notifier, "send">;
  now?: () => number;
  onLog?: (msg: string) => void;
}

/** 各类事件的默认冷却（秒） */
const TYPE_COOLDOWN_SEC: Partial<Record<EventType, number>> = {
  new_listing: 60,
  buy_order_change: 300,
  price_drop: 900,
  sniped: 600,
};

/** 连续失败多少轮后推送"监控异常"告警 */
const FAILURE_ALERT_THRESHOLD = 5;
/** 系统告警自身的冷却（秒） */
const SYSTEM_ALERT_COOLDOWN = 1800;

function effectiveCooldown(item: MonitorItem, settings: Settings, type: EventType): number {
  const base = Math.max(item.cooldownSec, settings.globalCooldownSec);
  return Math.max(base, TYPE_COOLDOWN_SEC[type] ?? 0);
}

/** 免打扰时段判断（固定按目标时区计算，默认北京时间） */
function inQuietHours(settings: Settings, d: Date): boolean {
  const { quietHoursStart, quietHoursEnd } = settings;
  if (!quietHoursStart || !quietHoursEnd) return false;
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const { h, m } = timePartsInZone(d);
  const nowMin = h * 60 + m;
  const s = toMin(quietHoursStart);
  const e = toMin(quietHoursEnd);
  if (s < e) return nowMin >= s && nowMin < e;
  return nowMin >= s || nowMin < e; // 跨天
}

/**
 * 执行一轮巡检：
 * 1. 抢分布式锁（避免 Cron 重入）
 * 2. 逐个物品抓快照 → diff → 冷却过滤 → 合并推送
 * 3. 更新健康状态；连续失败达阈值时推送系统告警
 */
export async function runRound(deps: RunnerDeps): Promise<RoundSummary> {
  const { store, steam, notifier } = deps;
  const now = deps.now ?? nowTs;
  const log = (m: string) => deps.onLog?.(m);

  const summary: RoundSummary = { skipped: false, itemsChecked: 0, itemsFailed: 0, pushed: 0, errors: [] };
  const lockKey = "monitor";
  if (!(await store.acquireLock(lockKey, 55))) {
    summary.skipped = true;
    summary.skipReason = "上一轮仍在执行";
    return summary;
  }

  const startedAt = now();
  try {
    const settings = await store.getSettings();
    const health = await store.getHealth();
    health.lastRunAt = startedAt;
    health.roundsRun += 1;
    health.itemsChecked = 0;
    health.itemsFailed = 0;
    health.pushed = 0;
    health.lastError = null;

    if (!settings.pollEnabled) {
      summary.skipped = true;
      summary.skipReason = "轮询已暂停（pollEnabled=false）";
      await store.saveHealth(health);
      return summary;
    }
    if (inQuietHours(settings, new Date(startedAt))) {
      summary.skipped = true;
      summary.skipReason = "处于免打扰时段";
      await store.saveHealth(health);
      return summary;
    }

    const items = (await store.getItems()).filter((i) => i.enabled);
    const roundEvents: Omit<EventRecord, "id" | "ts">[] = [];

    for (const item of items) {
      summary.itemsChecked += 1;
      health.itemsChecked += 1;
      try {
        const snap = await steam.snapshot(item);
        if (snap.nameId && item.nameId !== snap.nameId) {
          item.nameId = snap.nameId;
          await store.saveItems(items);
        }
        const prev = await store.getState(item.id);
        const { events, next } = detectChanges(prev, snap, item);
        await store.saveState(item.id, next);

        const sendable: DetectEvent[] = [];
        for (const e of events) {
          const cooldownMs = effectiveCooldown(item, settings, e.type) * 1000;
          const last = await store.lastNotify(`${item.id}:${e.type}`);
          if (last > 0 && now() - last < cooldownMs) continue;
          await store.setLastNotify(`${item.id}:${e.type}`, now());
          sendable.push(e);
        }

        if (sendable.length > 0) {
          const msg = buildItemMessage(item, sendable, now());
          let pushed = false;
          if (settings.webhookKey) {
            try {
              pushed = await notifier.send(settings.webhookKey, msg);
            } catch (e) {
              summary.errors.push(`[${item.displayName}] ${errMsg(e)}`);
            }
          }
          roundEvents.push(...sendable.map((e) => ({ ...e, pushed })));
          if (pushed) {
            summary.pushed += 1;
            health.pushed += 1;
          }
          log(`[${item.displayName}] 产生 ${sendable.length} 条事件，推送${pushed ? "成功" : "未推送"}`);
        }
      } catch (e) {
        summary.itemsFailed += 1;
        health.itemsFailed += 1;
        summary.errors.push(`[${item.displayName}] ${errMsg(e)}`);
      }
    }

    const wasFailing = health.consecutiveFailures >= FAILURE_ALERT_THRESHOLD;
    if (summary.itemsFailed === 0) {
      health.consecutiveFailures = 0;
    } else if (summary.itemsFailed >= summary.itemsChecked) {
      health.consecutiveFailures += 1;
    }

    // 系统级告警：监控连续失败 / 恢复
    const sysEvents: DetectEvent[] = [];
    if (health.consecutiveFailures === FAILURE_ALERT_THRESHOLD) {
      sysEvents.push({
        itemId: "system",
        type: "monitor_error",
        title: "监控连续失败",
        detail: `已连续 ${health.consecutiveFailures} 轮全部失败：${summary.errors.slice(0, 3).join("；")}`,
      });
    } else if (health.consecutiveFailures === 0 && wasFailing) {
      sysEvents.push({
        itemId: "system",
        type: "monitor_recovered",
        title: "监控已恢复",
        detail: "Steam 市场接口恢复正常，监控继续运行。",
      });
    }
    if (health.consecutiveFailures === 0) {
      health.lastSuccessAt = now();
    }
    if (summary.itemsFailed > 0) health.lastError = summary.errors.slice(0, 3).join("；");

    if (sysEvents.length > 0) {
      // 错误告警受冷却限制；恢复消息是状态迁移触发（本身就罕见），不设冷却
      const isError = sysEvents.some((e) => e.type === "monitor_error");
      const lastSys = await store.lastNotify("system:error");
      const allowed = !isError || lastSys === 0 || now() - lastSys >= SYSTEM_ALERT_COOLDOWN * 1000;
      if (allowed) {
        if (isError) await store.setLastNotify("system:error", now());
        if (settings.webhookKey) {
          try {
            await notifier.send(settings.webhookKey, buildSystemMessage(sysEvents, now()));
            roundEvents.push(...sysEvents.map((e) => ({ ...e, pushed: true })));
          } catch (e) {
            summary.errors.push(`[系统告警] ${errMsg(e)}`);
            roundEvents.push(...sysEvents.map((e) => ({ ...e, pushed: false })));
          }
        } else {
          roundEvents.push(...sysEvents.map((e) => ({ ...e, pushed: false })));
        }
      }
    }

    await store.addEvents(roundEvents, now());
    health.durationMs = now() - startedAt;
    await store.saveHealth(health);
    return summary;
  } finally {
    await store.releaseLock(lockKey);
  }
}
