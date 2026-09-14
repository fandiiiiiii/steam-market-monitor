import type { MonitorItem } from "@steam-monitor/core";

const NUM_FIELDS = ["maxPrice", "minBuyPrice", "priceDropPct"] as const;
const BOOL_FIELDS = ["enabled", "watchSell", "watchBuy", "snipedAlert"] as const;

/** 校验并转换“新建物品”请求体 */
export function coerceItemInput(body: any): { ok: true; item: Omit<MonitorItem, "id" | "createdAt"> } | { ok: false; error: string } {
  const appId = Number(body?.appId);
  const marketHashName = typeof body?.marketHashName === "string" ? body.marketHashName.trim() : "";
  if (!Number.isFinite(appId) || appId <= 0) return { ok: false, error: "appId 无效" };
  if (!marketHashName) return { ok: false, error: "marketHashName 不能为空" };

  const item: Omit<MonitorItem, "id" | "createdAt"> = {
    appId,
    marketHashName,
    displayName: typeof body?.displayName === "string" && body.displayName.trim() ? body.displayName.trim() : marketHashName,
    enabled: true,
    watchSell: true,
    watchBuy: true,
    maxPrice: null,
    minBuyPrice: null,
    priceDropPct: null,
    snipedAlert: false,
    cooldownSec: 60,
    nameId: null,
  };
  for (const f of NUM_FIELDS) {
    if (body?.[f] === null || body?.[f] === "" || body?.[f] === undefined) {
      item[f] = null;
    } else {
      const n = Number(body[f]);
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: `${f} 必须是正数或留空` };
      item[f] = n;
    }
  }
  if (item.priceDropPct != null && item.priceDropPct > 100) return { ok: false, error: "priceDropPct 需 ≤ 100" };
  for (const f of BOOL_FIELDS) {
    if (body?.[f] !== undefined) item[f] = !!body[f];
  }
  if (body?.cooldownSec !== undefined) {
    const n = Number(body.cooldownSec);
    if (!Number.isFinite(n) || n < 10 || n > 86400) return { ok: false, error: "cooldownSec 需在 10~86400 之间" };
    item.cooldownSec = n;
  }
  return { ok: true, item };
}
