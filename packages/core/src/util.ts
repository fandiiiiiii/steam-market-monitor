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

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  HKD: "HK$",
  USD: "$",
};

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? "¥";
}

/** 解析时区：兼容 ":UTC" 等特殊格式，非法值回退到北京时间 */
function resolveTimeZone(): string {
  const raw = (process.env.TZ ?? "").replace(/^:/, "").trim();
  if (!raw) return "Asia/Shanghai";
  try {
    new Intl.DateTimeFormat("en", { timeZone: raw });
    return raw;
  } catch {
    return "Asia/Shanghai";
  }
}

const DEFAULT_TIME_ZONE = resolveTimeZone();

/** 服务器时间按目标时区格式化（默认 Asia/Shanghai） */
export function fmtTime(ts: number): string {
  const s = new Date(ts).toLocaleString("zh-CN", { timeZone: DEFAULT_TIME_ZONE, hour12: false });
  return s.replace(/\//g, "-");
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
