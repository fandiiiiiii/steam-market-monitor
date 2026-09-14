import { randomUUID } from "node:crypto";

export function genId(): string {
  return randomUUID();
}

export function nowTs(): number {
  return Date.now();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 千分位、两位小数的价格显示 */
export function fmtPrice(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * 规范化企业微信 webhook key：
 * 用户可能粘贴完整地址（.../webhook/send?key=xxxx）或只粘贴 key，这里统一提取 key 部分。
 */
export function normalizeWebhookKey(input: string): string {
  const s = input.trim();
  const m = s.match(/key=([0-9a-zA-Z\-]{8,})/);
  if (m) return m[1];
  return s;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  HKD: "HK$",
  USD: "$",
};

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? "¥";
}

/**
 * 解析时区：默认北京时间；仅当用户明确配置了非 UTC 的 TZ 时才使用。
 * （Vercel 运行时固定注入 TZ=UTC，兼容 ":UTC" 格式，均回退到 Asia/Shanghai）
 */
function resolveTimeZone(): string {
  const raw = (process.env.TZ ?? "").replace(/^:/, "").trim();
  if (!raw || raw.toUpperCase() === "UTC") return "Asia/Shanghai";
  try {
    new Intl.DateTimeFormat("en", { timeZone: raw });
    return raw;
  } catch {
    return "Asia/Shanghai";
  }
}

const DEFAULT_TIME_ZONE = resolveTimeZone();

/** 时间戳按目标时区（默认北京时间）格式化为 YYYY-MM-DD HH:mm:ss */
export function fmtTime(ts: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/** 取指定时区下的 {h, m}（用于免打扰时段判断，避免服务器时区造成偏移） */
export function timePartsInZone(d: Date, timeZone = DEFAULT_TIME_ZONE): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { h, m };
}

export function marketUrl(appId: number, marketHashName: string): string {
  return `https://steamcommunity.com/market/listings/${appId}/${encodeURIComponent(marketHashName)}`;
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** 按 UTF-8 字节数截断文本（企业微信 markdown 上限 4096 字节） */
export function truncateBytes(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= maxBytes) return s;
  const ellipsis = Buffer.from("…", "utf8");
  const cut = buf.subarray(0, maxBytes - ellipsis.length);
  return cut.toString("utf8") + "…";
}
