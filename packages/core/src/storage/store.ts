import type {
  EngineState,
  EventRecord,
  Health,
  MonitorItem,
  Settings,
} from "../types.ts";
import { genId, nowTs } from "../util.ts";
import type { KVStorage } from "./kv.ts";

const KEY_ITEMS = "items";
const KEY_SETTINGS = "settings";
const KEY_HEALTH = "health";
const KEY_EVENTS = "events";
const EVENTS_CAP = 500;

const DEFAULT_SETTINGS: Settings = {
  webhookKey: "",
  pollEnabled: true,
  globalCooldownSec: 60,
  quietHoursStart: null,
  quietHoursEnd: null,
};

export const DEFAULT_HEALTH: Health = {
  lastRunAt: 0,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  roundsRun: 0,
  lastError: null,
  itemsChecked: 0,
  itemsFailed: 0,
  pushed: 0,
  durationMs: 0,
};

function jsonParse<T>(s: string | null, fallback: T): T {
  if (s == null) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** 数据仓储：把业务对象序列化到 KVStorage，键名统一管理 */
export class Store {
  private readonly kv: KVStorage;

  constructor(kv: KVStorage) {
    this.kv = kv;
  }

  // ---- 物品 ----
  async getItems(): Promise<MonitorItem[]> {
    const list = jsonParse<MonitorItem[]>(await this.kv.get(KEY_ITEMS), []);
    return Array.isArray(list) ? list : [];
  }

  async saveItems(items: MonitorItem[]): Promise<void> {
    await this.kv.set(KEY_ITEMS, JSON.stringify(items));
  }

  // ---- 设置 ----
  async getSettings(): Promise<Settings> {
    const s = jsonParse<Partial<Settings>>(await this.kv.get(KEY_SETTINGS), {});
    return { ...DEFAULT_SETTINGS, ...s };
  }

  async saveSettings(s: Settings): Promise<void> {
    await this.kv.set(KEY_SETTINGS, JSON.stringify(s));
  }

  // ---- 引擎状态 ----
  async getState(itemId: string): Promise<EngineState | null> {
    return jsonParse<EngineState | null>(await this.kv.get(`state:${itemId}`), null);
  }

  async saveState(itemId: string, state: EngineState): Promise<void> {
    await this.kv.set(`state:${itemId}`, JSON.stringify(state));
  }

  // ---- 冷却标记 ----
  async lastNotify(key: string): Promise<number> {
    const v = await this.kv.get(`notify:${key}`);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  async setLastNotify(key: string, ts: number): Promise<void> {
    await this.kv.set(`notify:${key}`, String(ts));
  }

  // ---- 事件日志 ----
  async getEvents(itemId?: string, limit = 200): Promise<EventRecord[]> {
    const list = jsonParse<EventRecord[]>(await this.kv.get(KEY_EVENTS), []);
    const filtered = itemId ? list.filter((e) => e.itemId === itemId) : list;
    return filtered.slice(0, limit);
  }

  async addEvents(events: Omit<EventRecord, "id" | "ts">[], ts = nowTs()): Promise<void> {
    if (events.length === 0) return;
    const list = jsonParse<EventRecord[]>(await this.kv.get(KEY_EVENTS), []);
    const records: EventRecord[] = events.map((e) => ({ ...e, id: genId(), ts }));
    list.unshift(...records);
    await this.kv.set(KEY_EVENTS, JSON.stringify(list.slice(0, EVENTS_CAP)));
  }

  // ---- 健康 ----
  async getHealth(): Promise<Health> {
    return { ...DEFAULT_HEALTH, ...jsonParse<Partial<Health>>(await this.kv.get(KEY_HEALTH), {}) };
  }

  async saveHealth(h: Health): Promise<void> {
    await this.kv.set(KEY_HEALTH, JSON.stringify(h));
  }

  // ---- 分布式锁（防止 Cron 重入 / 并发执行）----
  async acquireLock(name: string, ttlSec: number): Promise<boolean> {
    return this.kv.set(`lock:${name}`, String(nowTs()), { nx: true, ex: ttlSec });
  }

  async releaseLock(name: string): Promise<void> {
    await this.kv.del(`lock:${name}`);
  }
}
