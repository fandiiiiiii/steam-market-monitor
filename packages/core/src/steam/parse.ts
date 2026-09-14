import type { SellListing } from "../types.ts";

/**
 * 解析 Steam 价格字符串，如 "¥ 1,234.56"、"起价 ¥ 0.03"、"$0.03"。
 * 取第一个数字型 token，忽略货币符号与"起价"等前缀。
 */
export function parsePriceString(s: string | null | undefined): number | null {
  if (s == null) return null;
  const m = s.match(/[\d][\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export interface ListingBlock {
  listingId: string;
  assetId: string;
  block: string;
}

/**
 * 把 HTML 按 `<div ... id="listing_{listingid}_{assetid}" ...>` 切块。
 * 每个块是从该行开标签到下一行开标签（或结尾）之间的片段。
 */
export function splitListingBlocks(html: string): ListingBlock[] {
  const re = /id="listing_(\d+)_(\d+)"/g;
  const matches: Array<{ index: number; listingId: string; assetId: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    matches.push({ index: m.index, listingId: m[1], assetId: m[2] });
  }
  return matches.map((mm, i) => ({
    listingId: mm.listingId,
    assetId: mm.assetId,
    block: html.slice(mm.index, i + 1 < matches.length ? matches[i + 1].index : Math.min(html.length, mm.index + 2000)),
  }));
}

const PRICE_RE = /market_listing_price_with_fee[^>]*>([^<]+)</;

/**
 * 从出售行块中提取 listing 列表。
 * @param hashFilter 仅保留块内出现该物品市场链接（如 /market/listings/{appid}/{hash}）的行；
 *                   用于物品页降级解析，过滤"最近查看"等无关行。
 */
export function parseSellRows(
  html: string,
  hashFilter?: { appId: number; marketHashName: string },
): SellListing[] {
  const blocks = splitListingBlocks(html);
  const out: SellListing[] = [];
  const linkToken = hashFilter
    ? `/market/listings/${hashFilter.appId}/${encodeURIComponent(hashFilter.marketHashName)}`
    : null;
  for (const b of blocks) {
    if (linkToken && !b.block.includes(linkToken)) continue;
    const pm = b.block.match(PRICE_RE);
    const price = parsePriceString(pm?.[1]);
    if (price == null) continue;
    out.push({ listingId: b.listingId, assetId: b.assetId, price });
  }
  return out;
}

export interface ItemSearchResult {
  marketHashName: string;
  name: string;
  iconUrl?: string;
  /** 在售数量（官方搜索接口返回） */
  sellListings?: number;
  /** 最低售价（官方搜索接口返回，已换算为主币种单位） */
  sellPrice?: number;
}

/** 官方搜索接口（新结构化格式）的单条结果 */
export interface SteamSearchResultEntry {
  name?: string;
  hash_name?: string;
  app_icon?: string;
  sell_listings?: number;
  sell_price?: number;
}

/**
 * 解析新版市场搜索接口的 results 数组（结构化 JSON，不再是 HTML）。
 * 注意：官方 sell_price 以"分"为单位（如 21094 = 210.94），这里换算成主币种单位。
 */
export function parseSearchResultsJson(entries: unknown): ItemSearchResult[] {
  if (!Array.isArray(entries)) return [];
  const out: ItemSearchResult[] = [];
  for (const e of entries) {
    const entry = (e ?? {}) as SteamSearchResultEntry;
    if (typeof entry.hash_name !== "string" || !entry.hash_name) continue;
    const sellPriceRaw = Number(entry.sell_price);
    out.push({
      marketHashName: entry.hash_name,
      name: typeof entry.name === "string" && entry.name ? entry.name : entry.hash_name,
      iconUrl: entry.app_icon,
      sellListings: Number.isFinite(Number(entry.sell_listings)) ? Number(entry.sell_listings) : undefined,
      sellPrice: Number.isFinite(sellPriceRaw) ? sellPriceRaw / 100 : undefined,
    });
  }
  return out;
}

/**
 * 解析 market/search/render 返回的 results_html，得到"物品"搜索结果（按物品去重）。
 * 搜索结果里每行都是该物品的一条 listing，同一物品可能多行，这里取每行中的物品名与市场链接。
 */
export function parseSearchResults(html: string, appId: number): ItemSearchResult[] {
  const blocks = splitListingBlocks(html);
  const seen = new Set<string>();
  const out: ItemSearchResult[] = [];
  for (const b of blocks) {
    const linkM = b.block.match(/market\/listings\/(\d+)\/([^"?#]+)/);
    if (!linkM || Number(linkM[1]) !== appId) continue;
    let marketHashName: string;
    try {
      marketHashName = decodeURIComponent(linkM[2]);
    } catch {
      marketHashName = linkM[2];
    }
    if (seen.has(marketHashName)) continue;
    seen.add(marketHashName);
    const nameM = b.block.match(/market_listing_item_name"[^>]*>([\s\S]*?)</);
    const iconM = b.block.match(/market_listing_item_img[^>]*src="([^"]+)"/);
    out.push({
      marketHashName,
      name: nameM ? nameM[1].trim() : marketHashName,
      iconUrl: iconM?.[1],
    });
    if (out.length >= 30) break;
  }
  return out;
}

/** 从物品市场页 HTML 中提取 item_nameid（Market_LoadOrderSpread(N)） */
export function extractNameId(html: string): number | null {
  const m = html.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/);
  return m ? Number(m[1]) : null;
}

/**
 * 解析 Steam 市场商品页 URL，得到 {appId, marketHashName}。
 * 支持 steamcommunity.com/market/listings/APPID/HASH 及其带查询参数的形式。
 */
export function parseMarketUrl(url: string): { appId: number; marketHashName: string } | null {
  const m = url.match(/market\/listings\/(\d+)\/([^/?#"]+)/i);
  if (!m) return null;
  const appId = Number(m[1]);
  if (!Number.isFinite(appId) || appId <= 0) return null;
  let hash: string;
  try {
    hash = decodeURIComponent(m[2]);
  } catch {
    hash = m[2];
  }
  if (!hash) return null;
  return { appId, marketHashName: hash };
}
