import { ProxyAgent } from "undici";
import type { Histogram, HistogramPoint, ItemSnapshot, MonitorItem } from "../types.ts";
import { errMsg, sleep } from "../util.ts";
import {
  type ItemSearchResult,
  extractNameId,
  parseMarketUrl,
  parseSearchResultsJson,
} from "./parse.ts";

export interface SteamClientOptions {
  /** Steam 社区根地址，默认 https://steamcommunity.com（测试时可指向 mock） */
  baseUrl?: string;
  /** 目标货币，23 = CNY（人民币） */
  currency?: number;
  /** 界面语言 */
  language?: string;
  /** 地区代码 */
  country?: string;
  /** HTTP(S) 代理，如 http://127.0.0.1:7890（本地运行时绕过网络限制用） */
  proxyUrl?: string;
  /** Steam 登录 Cookie（steamLoginSecure=...; sessionid=...），用于获取真实币种价格与完整数据 */
  cookies?: string;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  /** 全局请求最小间隔（毫秒），用于对 Steam 接口限速 */
  minIntervalMs?: number;
  logger?: (msg: string) => void;
}

class RetriableError extends Error {}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const RETRY_DELAYS = [1200, 2600];

function isRetriable(e: unknown): boolean {
  if (e instanceof RetriableError) return true;
  if (e instanceof TypeError) return true; // 网络错误（fetch 失败通常抛 TypeError）
  const msg = errMsg(e);
  return /abort|timeout|fetch failed|ECONNRESET|ECONNREFUSED|UND_ERR/i.test(msg);
}

export class SteamClient {
  private readonly baseUrl: string;
  private readonly currency: number;
  private readonly language: string;
  private readonly country: string;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly maxRetries = 2;
  private readonly fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  private readonly dispatcher: ProxyAgent | undefined;
  private readonly logger?: (msg: string) => void;
  private lastReqAt = 0;
  private cookieHeader = "";

  constructor(opts: SteamClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://steamcommunity.com").replace(/\/+$/, "");
    this.currency = opts.currency ?? 23;
    this.language = opts.language ?? "schinese";
    this.country = opts.country ?? "CN";
    this.timeoutMs = opts.timeoutMs ?? 12000;
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.dispatcher = opts.proxyUrl ? new ProxyAgent(opts.proxyUrl) : undefined;
    this.logger = opts.logger;
    this.cookieHeader = opts.cookies ?? "";
  }

  /** 动态更新 Cookie（云端从设置中读取后注入） */
  setCookies(cookies: string): void {
    this.cookieHeader = cookies;
  }

  private log(msg: string) {
    this.logger?.(`[steam] ${msg}`);
  }

  private async throttle(): Promise<void> {
    const wait = this.lastReqAt + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastReqAt = Date.now();
  }

  private async http(path: string, as: "json" | "text" = "json", attempt = 0): Promise<any> {
    await this.throttle();
    const url = `${this.baseUrl}${path}`;
    try {
      const res = await this.fetchImpl(url, {
        headers: {
          accept: as === "json" ? "application/json, text/plain, */*" : "text/html, */*",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          "user-agent": DEFAULT_UA,
          ...(this.cookieHeader ? { cookie: this.cookieHeader } : {}),
        },
        redirect: "follow",
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(this.dispatcher ? ({ dispatcher: this.dispatcher } as any) : {}),
      });
      if (res.status === 429 || res.status >= 500) {
        throw new RetriableError(`Steam 返回 HTTP ${res.status}`);
      }
      if (!res.ok) {
        throw new Error(`Steam 返回 HTTP ${res.status}`);
      }
      const text = await res.text();
      return as === "json" ? JSON.parse(text) : text;
    } catch (e) {
      if (isRetriable(e) && attempt < this.maxRetries) {
        const delay = RETRY_DELAYS[attempt] + Math.floor(Math.random() * 400);
        this.log(`${path} 请求失败（${errMsg(e)}），${delay}ms 后重试 (${attempt + 1}/${this.maxRetries})`);
        await sleep(delay);
        return this.http(path, as, attempt + 1);
      }
      if (e instanceof RetriableError) {
        throw new Error(`Steam 接口请求失败：${errMsg(e)}`);
      }
      throw e instanceof Error ? e : new Error(errMsg(e));
    }
  }

  /** 物品页 HTML（用于解析 nameid） */
  private itemPagePath(appId: number, marketHashName: string): string {
    const hash = encodeURIComponent(marketHashName);
    return `/market/listings/${appId}/${hash}?l=${this.language}&country=${this.country}`;
  }

  /** 从物品页解析 item_nameid（histogram 接口必需；失败返回 null，不阻塞监控） */
  async resolveNameId(appId: number, marketHashName: string): Promise<number | null> {
    const html: string = await this.http(this.itemPagePath(appId, marketHashName), "text");
    return extractNameId(html);
  }

  /** itemordershistogram：出售/求购聚合柱状图（需要 nameid） */
  async getHistogram(appId: number, nameId: number): Promise<Histogram> {
    const json = await this.http(
      `/market/itemordershistogram?country=${this.country}&language=${this.language}&currency=${this.currency}&item_nameid=${nameId}&two_factor=0`,
      "json",
    );
    if (!json || json.success !== 1) {
      throw new Error(json?.success === 2 ? "Steam 限流（success=2）" : `histogram 响应异常：${JSON.stringify(json).slice(0, 200)}`);
    }
    const num = (v: unknown): number | null => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const graph = (arr: unknown): HistogramPoint[] =>
      Array.isArray(arr)
        ? arr
            .map((p) => ({ price: Number(p?.[0]), quantity: Number(p?.[1]) }))
            .filter((p) => Number.isFinite(p.price) && Number.isFinite(p.quantity) && p.quantity > 0)
        : [];
    return {
      sellOrderCount: num(json.sell_order_count) ?? 0,
      buyOrderCount: num(json.buy_order_count) ?? 0,
      lowestSellOrder: num(json.lowest_sell_order),
      highestBuyOrder: num(json.highest_buy_order),
      sellGraph: graph(json.sell_order_graph),
      buyGraph: graph(json.buy_order_graph),
      pricePrefix: typeof json.price_prefix === "string" ? json.price_prefix : "",
    };
  }

  /** 市场搜索（新版结构化接口）。query 支持中文名；返回按物品去重后的结果（最多两页 20 条） */
  async searchItems(appId: number, query: string, start = 0, count = 100): Promise<ItemSearchResult[]> {
    const q = encodeURIComponent(query.trim());
    const qPart = q ? `query=${q}&` : "";
    const fetchPage = async (s: number) => {
      const json = await this.http(
        `/market/search/render/?${qPart}start=${s}&count=${count}&search_descriptions=0&appid=${appId}&currency=${this.currency}&country=${this.country}&l=${this.language}&norender=1`,
        "json",
      );
      if (!json || json.success !== true) return null;
      return { total: Number(json.total_count), results: parseSearchResultsJson(json.results) };
    };
    const first = await fetchPage(start);
    if (!first) return [];
    const merged = [...first.results];
    // Steam 每页固定返回 10 条：结果还有剩余时再取一页（最多 20 条，足够搜索选物）
    if (first.results.length >= 10 && (Number.isFinite(first.total) ? first.total : 0) > 10) {
      const second = await fetchPage(start + 10);
      if (second) merged.push(...second.results);
    }
    const seen = new Set<string>();
    return merged.filter((r) => {
      if (seen.has(r.marketHashName)) return false;
      seen.add(r.marketHashName);
      return true;
    });
  }

  /**
   * 按市场名精确查询单个物品的在售数量与最低价。
   * - 接口请求失败：抛异常（调用方按"数据未知"处理）
   * - 成功但无该物品结果：返回 { found: false }（视为 0 在售）
   */
  async searchItemExact(
    appId: number,
    marketHashName: string,
  ): Promise<
    | { found: true; sellCount: number; sellPrice: number | null; sellPriceCurrency: string | null }
    | { found: false }
  > {
    const q = encodeURIComponent(marketHashName);
    const json = await this.http(
      `/market/search/render/?query=${q}&start=0&count=100&search_descriptions=0&appid=${appId}&currency=${this.currency}&country=${this.country}&l=${this.language}&norender=1`,
      "json",
    );
    if (!json || json.success !== true) return { found: false };
    const results = parseSearchResultsJson(json.results);
    const hit = results.find((r) => r.marketHashName === marketHashName);
    if (!hit) return { found: false };
    return {
      found: true,
      sellCount: hit.sellListings ?? 0,
      sellPrice: hit.sellPrice ?? null,
      sellPriceCurrency: hit.sellPriceCurrency ?? null,
    };
  }

  /**
   * 抓取指定 appid 的完整市场目录（用于中文模糊搜索索引）。
   * 注意：Steam 每页最多返回 10 条，需要按 start 翻页；零在售物品不会出现在目录中。
   */
  async browseCatalog(appId: number, maxPages = 30): Promise<ItemSearchResult[]> {
    const PAGE = 10;
    const first = await this.http(
      `/market/search/render/?start=0&count=${PAGE}&search_descriptions=0&appid=${appId}&currency=${this.currency}&country=${this.country}&l=${this.language}&norender=1`,
      "json",
    );
    if (!first || first.success !== true) return [];
    const total = Number(first.total_count);
    const all: ItemSearchResult[] = parseSearchResultsJson(first.results);
    const pages = Math.min(Math.max(1, Math.ceil((Number.isFinite(total) ? total : 0) / PAGE)), maxPages);
    for (let p = 1; p < pages; p++) {
      const json = await this.http(
        `/market/search/render/?start=${p * PAGE}&count=${PAGE}&search_descriptions=0&appid=${appId}&currency=${this.currency}&country=${this.country}&l=${this.language}&norender=1`,
        "json",
      );
      if (!json || json.success !== true) break;
      all.push(...parseSearchResultsJson(json.results));
    }
    const seen = new Set<string>();
    return all.filter((r) => {
      if (seen.has(r.marketHashName)) return false;
      seen.add(r.marketHashName);
      return true;
    });
  }

  /**
   * 拉取物品完整快照：搜索接口（在售数量+最低价，主数据）+ 柱状图（求购，可选）。
   * 两个来源各自容错，互不阻塞。
   */
  async snapshot(
    item: Pick<MonitorItem, "appId" | "marketHashName" | "nameId">,
  ): Promise<ItemSnapshot & { nameId?: number | null }> {
    let exact:
      | { found: true; sellCount: number; sellPrice: number | null; sellPriceCurrency: string | null }
      | { found: false }
      | null = null;
    try {
      exact = await this.searchItemExact(item.appId, item.marketHashName);
    } catch (e) {
      this.log(`精确查询失败（数据视为未知）：${errMsg(e)}`);
    }

    const [nameId] = await Promise.all([
      item.nameId
        ? Promise.resolve(item.nameId)
        : this.resolveNameId(item.appId, item.marketHashName).catch(() => null),
    ]);

    let histogram: Histogram | null = null;
    if (nameId) {
      try {
        histogram = await this.getHistogram(item.appId, nameId);
      } catch (e) {
        this.log(`histogram 获取失败（已降级）：${errMsg(e)}`);
      }
    }

    const found = exact?.found === true;
    if (!found && !histogram && exact === null) {
      throw new Error(`未获取到该物品的任何市场数据（请确认物品名正确）：${item.marketHashName}`);
    }

    return {
      histogram,
      // found=false → 该物品当前无在售（0 件）；null → 接口失败，数据未知
      sellCount: exact ? (found ? exact.sellCount : 0) : null,
      sellPrice: exact && found ? exact.sellPrice : null,
      sellPriceCurrency: exact && found ? exact.sellPriceCurrency : null,
      fetchedAt: Date.now(),
      nameId,
    };
  }
}

export { parseMarketUrl };
