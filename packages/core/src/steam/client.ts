import { ProxyAgent } from "undici";
import type { Histogram, HistogramPoint, ItemSnapshot, MonitorItem, SellListing } from "../types.ts";
import { errMsg, sleep } from "../util.ts";
import {
  type ItemSearchResult,
  extractNameId,
  parseMarketUrl,
  parseSearchResults,
  parseSellRows,
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

  /** 物品页 HTML（用于解析 nameid / 降级解析出售行） */
  private itemPagePath(appId: number, marketHashName: string): string {
    const hash = encodeURIComponent(marketHashName);
    return `/market/listings/${appId}/${hash}?l=${this.language}&country=${this.country}`;
  }

  /** 从物品页解析 item_nameid（histogram 接口必需） */
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
    };
  }

  /**
   * 在售列表主路径：物品页"加载更多"接口（market/listings/{appid}/{hash}/render），
   * 返回单条出售单（含 listingId），比搜索接口更准确。
   */
  private async getListingsViaRender(
    appId: number,
    marketHashName: string,
    count: number,
  ): Promise<{ listings: SellListing[]; totalCount: number | null } | null> {
    const json = await this.http(
      `/market/listings/${appId}/${encodeURIComponent(marketHashName)}/render/?start=0&count=${count}&currency=${this.currency}&language=${this.language}&format=json`,
      "json",
    );
    if (!json || json.success !== true) return null;
    const total = Number(json.total_count);
    // render 结果只含该物品的出售单，无需按物品名过滤
    const listings = parseSellRows(json.results_html ?? "");
    return { listings, totalCount: Number.isFinite(total) ? total : null };
  }

  /** 通过市场搜索接口按物品名精确查询在售列表（次选路径，货币可控） */
  private async getListingsViaSearch(
    appId: number,
    marketHashName: string,
    count: number,
  ): Promise<{ listings: SellListing[]; totalCount: number | null; source: "search" | "page" } | null> {
    const q = encodeURIComponent(marketHashName);
    const json = await this.http(
      `/market/search/render/?query=${q}&start=0&count=${count}&search_descriptions=0&sort_column=price&sort_dir=asc&appid=${appId}&currency=${this.currency}&l=${this.language}&norender=1`,
      "json",
    );
    if (!json || json.success !== true) return null;
    const total = Number(json.total_count);
    const listings = parseSellRows(json.results_html ?? "", { appId, marketHashName });
    if (listings.length > 0 || (Number.isFinite(total) && total === 0)) {
      return { listings, totalCount: Number.isFinite(total) ? total : null, source: "search" };
    }
    return null;
  }

  /** 兜底路径：解析物品页 HTML 前 10 条在售（币种可能随服务器地区变化，仅作兜底） */
  private async getListingsViaPage(appId: number, marketHashName: string): Promise<SellListing[]> {
    const html: string = await this.http(this.itemPagePath(appId, marketHashName), "text");
    return parseSellRows(html, { appId, marketHashName });
  }

  async getListings(
    appId: number,
    marketHashName: string,
    count = 100,
  ): Promise<{ listings: SellListing[]; totalCount: number | null; source: "render" | "search" | "page" }> {
    try {
      const viaRender = await this.getListingsViaRender(appId, marketHashName, count);
      if (viaRender && (viaRender.listings.length > 0 || viaRender.totalCount === 0)) {
        return { ...viaRender, source: "render" };
      }
    } catch (e) {
      this.log(`render 接口失败（${errMsg(e)}），尝试搜索接口`);
    }
    try {
      const viaSearch = await this.getListingsViaSearch(appId, marketHashName, count);
      if (viaSearch) return viaSearch;
    } catch (e) {
      this.log(`搜索接口失败（${errMsg(e)}），降级解析物品页`);
    }
    const rows = await this.getListingsViaPage(appId, marketHashName);
    return { listings: rows, totalCount: null, source: "page" };
  }

  /** 市场物品搜索（按关键字），返回按物品去重后的结果 */
  async searchItems(appId: number, query: string): Promise<ItemSearchResult[]> {
    const q = encodeURIComponent(query.trim());
    if (!q) return [];
    const json = await this.http(
      `/market/search/render/?query=${q}&start=0&count=20&search_descriptions=0&appid=${appId}&currency=${this.currency}&l=${this.language}&norender=1`,
      "json",
    );
    if (!json || json.success !== true) return [];
    return parseSearchResults(json.results_html ?? "", appId);
  }

  /** 拉取物品完整快照（柱状图 + 在售列表），histogram 失败时降级返回 null */
  async snapshot(item: Pick<MonitorItem, "appId" | "marketHashName" | "nameId">): Promise<ItemSnapshot & { nameId?: number }> {
    const nameId = item.nameId ?? (await this.resolveNameId(item.appId, item.marketHashName));
    if (!nameId) {
      throw new Error(`无法解析 item_nameid，请检查物品名是否存在：${item.marketHashName}`);
    }
    const [h, l] = await Promise.allSettled([
      this.getHistogram(item.appId, nameId),
      this.getListings(item.appId, item.marketHashName),
    ]);
    if (h.status === "rejected" && l.status === "rejected") {
      throw l.reason instanceof Error ? l.reason : new Error(errMsg(l.reason));
    }
    if (h.status === "rejected") this.log(`histogram 获取失败（已降级）：${errMsg(h.reason)}`);
    if (l.status === "rejected") this.log(`在售列表获取失败（已降级）：${errMsg(l.reason)}`);
    return {
      histogram: h.status === "fulfilled" ? h.value : null,
      listings: l.status === "fulfilled" ? l.value.listings : [],
      totalListings: l.status === "fulfilled" ? l.value.totalCount : null,
      fetchedAt: Date.now(),
      nameId,
    };
  }
}

export { parseMarketUrl };
