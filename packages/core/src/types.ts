/** 监控事件的类型 */
export type EventType =
  | "new_listing" // 卖家新上架出售单
  | "buy_order_change" // 求购订单变化（新价位 / 数量增加 / 最高求购价上升）
  | "price_drop" // 最低售价下降
  | "sniped" // 最低价出售单消失（大概率被买走）
  | "monitor_error" // 监控连续失败告警
  | "monitor_recovered" // 监控恢复
  | "system";

/** 一个被监控的 Steam 市场物品 */
export interface MonitorItem {
  id: string;
  /** Steam appid，如永劫无间 1203220 */
  appId: number;
  /** market_hash_name（解码后的形式，与市场 URL 路径一致） */
  marketHashName: string;
  /** 用户自定义显示名 */
  displayName: string;
  enabled: boolean;
  /** 是否监控卖家上架 */
  watchSell: boolean;
  /** 是否监控求购订单 */
  watchBuy: boolean;
  /** 出售提醒的价格上限（≤ 该价格才提醒），空 = 不限 */
  maxPrice?: number | null;
  /** 求购提醒的最低价格（≥ 该价格才提醒），空 = 不限 */
  minBuyPrice?: number | null;
  /** 降价提醒阈值（百分比，如 5 表示降幅 ≥5% 才提醒），空 = 关闭 */
  priceDropPct?: number | null;
  /** 最低价被秒提醒开关 */
  snipedAlert: boolean;
  /** 该物品市场类事件的冷却秒数 */
  cooldownSec: number;
  /** Steam item_nameid（懒加载缓存，histogram 接口需要） */
  nameId?: number | null;
  createdAt: number;
}

/** 全局设置 */
export interface Settings {
  /** 企业微信机器人 webhook key */
  webhookKey: string;
  /** 总开关：是否轮询 */
  pollEnabled: boolean;
  /** 全局事件冷却秒数（与物品级冷却取较大值） */
  globalCooldownSec: number;
  /** 免打扰时段起 "HH:mm"（按北京时间），空 = 关闭 */
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  /** 显示/告警币种（Steam 搜索接口对匿名请求返回美元，按自动汇率换算为目标币种） */
  currency: "CNY" | "HKD" | "USD";
}

/** 单条出售单（保留类型定义，当前监控使用聚合数量/价格，不再逐条解析） */
export interface SellListing {
  listingId: string;
  assetId?: string;
  price: number;
}

export interface HistogramPoint {
  price: number;
  quantity: number;
}

/** itemordershistogram 解析结果 */
export interface Histogram {
  sellOrderCount: number;
  buyOrderCount: number;
  lowestSellOrder: number | null;
  highestBuyOrder: number | null;
  sellGraph: HistogramPoint[];
  buyGraph: HistogramPoint[];
  /** 价格前缀（如 ¥ / $ / HK$），用于判断币种 */
  pricePrefix: string;
}

/** 一轮抓取得到的物品快照（基于 Steam 官方搜索接口的聚合数据） */
export interface ItemSnapshot {
  histogram: Histogram | null;
  /** 在售数量（search 接口 sell_listings），null = 无数据 */
  sellCount: number | null;
  /** 最低售价（search 接口 sell_price，已换算为主币种单位），null = 无在售/无数据 */
  sellPrice: number | null;
  fetchedAt: number;
}

/** 引擎产出的检测事件（未落库、未过滤冷却） */
export interface DetectEvent {
  itemId: string;
  type: EventType;
  title: string;
  detail: string;
}

/** 落库的事件记录 */
export interface EventRecord extends DetectEvent {
  id: string;
  ts: number;
  pushed: boolean;
}

/** 每个物品的引擎状态（用于去重/diff） */
export interface EngineState {
  initialized: boolean;
  lastSellCount: number | null;
  lastSellPrice: number | null;
  highestBuy: number | null;
  buyGraph: HistogramPoint[];
  buyFingerprint: string | null;
  lastSeenAt: number;
  /** 稳定指纹（不含时间戳字段），runner 用于判断是否需要写回存储 */
  fp?: string | null;
}

/** 全局健康信息 */
export interface Health {
  lastRunAt: number;
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  roundsRun: number;
  lastError: string | null;
  itemsChecked: number;
  itemsFailed: number;
  pushed: number;
  durationMs: number;
}

/** 一轮巡检的汇总结果 */
export interface RoundSummary {
  skipped: boolean;
  skipReason?: string;
  itemsChecked: number;
  itemsFailed: number;
  pushed: number;
  errors: string[];
}
