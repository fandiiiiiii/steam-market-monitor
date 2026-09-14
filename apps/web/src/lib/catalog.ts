import type { ItemSearchResult } from "@steam-monitor/core";
import { kvBackend, steam } from "./singletons";

const TTL_MS = 24 * 3600 * 1000;

/**
 * 获取指定 appid 的市场目录索引（中文名 ↔ 英文市场名），
 * 缓存在 KV 中 24 小时；用于中文关键词模糊搜索。
 */
export async function getCatalog(appId: number): Promise<ItemSearchResult[]> {
  const key = `catalog:${appId}`;
  const cached = await kvBackend.kv.get(key);
  if (cached) {
    try {
      const j = JSON.parse(cached) as { at?: number; items?: ItemSearchResult[] };
      if (Array.isArray(j.items) && Date.now() - (j.at ?? 0) < TTL_MS) {
        return j.items;
      }
    } catch {
      // 缓存损坏则重建
    }
  }
  const items = await steam.browseCatalog(appId);
  if (items.length > 0) {
    await kvBackend.kv.set(key, JSON.stringify({ at: Date.now(), items }));
  }
  return items;
}

/** 对目录做中文/英文模糊匹配（子串），简单打分排序 */
export function fuzzyMatch(items: ItemSearchResult[], query: string, limit = 30): ItemSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  return items
    .map((it) => {
      const name = norm(it.name);
      const hash = norm(it.marketHashName);
      let score = -1;
      if (name === q || hash === q) score = 3;
      else if (name.includes(q) || hash.includes(q)) score = 2;
      else if (name.includes(q.replace(/\s+/g, ""))) score = 2;
      else if (q.length >= 2 && (q.includes(name) || q.includes(hash))) score = 1;
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.it.name.length - b.it.name.length)
    .slice(0, limit)
    .map((x) => x.it);
}
