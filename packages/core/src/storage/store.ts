import type {
  EngineState,
  EventRecord,
  Health,
  MonitorItem,
  Settings,
} from "../types.ts";
import { genId, nowTs } from "../util.ts";
import type { KVStorage } from "./kv.ts";

/**
 * 物品与设置合并存储在同一个 key（meta）下：巡检热路径每次只读一次。
 * 事件日志 / 引擎状态 / 冷却标记 / 健康 / 锁分别独立存储。
 */
const KEY_META = "meta";
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

interface Meta {
  items?: MonitorItem[];
  settings?: Partial<Settings>;
}

/** 数据仓储：把业务对象序列化到 KVStorage，键名统一管理 */
export class Store {
  private readonly kv: KVStorage;

  constructor(kv: KVStorage) {
    this.kv = kv;
  }

  // ---- meta（物品 + 设置，单键读取）----
  async getMeta(): Promise<{ items: MonitorItem[]; settings: Settings }> {
    const m = jsonParse<Meta>(await this.kv.get(KEY_META), {});
    const items = Array.isArray(m.items) ? m.items : [];
    const settings: Settings = { ...DEFAULT_SETTINGS, ...(m.settings ?? {}) };
    return { items, settings };
  }

  async saveMeta(items: MonitorItem[], settings: Settings): Promise<void> {
    await this.kv.set(KEY_META, JSON.stringify({ items, settings }));
  }

  // ---- 物品 ----
  async getItems(): Promise<MonitorItem[]> {
    return (await this.getMeta()).items;
  }

  async saveItems(items: MonitorItem[]): Promise<void> {
    const meta = await this.getMeta();
    await this.saveMeta(items, meta.settings);
  }

  // ---- 设置 ----
  async getSettings(): Promise<Settings> {
    return (await this.getMeta()).settings;
  }

  async saveSettings(s: Settings): Promise<void> {
    const meta = await this.getMeta();
    await this.saveMeta(meta.items, s);
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

  // ---- 分布式锁（防止并发执行）----
  async acquireLock(name: string, ttlSec: number): Promise<boolean> {
    return this.kv.set(`lock:${name}`, String(nowTs()), { nx: true, ex: ttlSec });
  }

  async releaseLock(name: string): Promise<void> {
    await this.kv.del(`lock:${name}`);
  }
}
