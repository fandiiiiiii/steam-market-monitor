import path from "node:path";
import { Redis } from "@upstash/redis";
import type { KVStorage } from "@steam-monitor/core";
import { FileKV } from "@steam-monitor/core";

/**
 * Upstash Redis 适配器（Vercel Marketplace 的 Redis 集成；Vercel KV 已于 2024/12 停用）。
 * 兼容注入变量：UPSTASH_REDIS_REST_URL/TOKEN（Upstash 集成）或 KV_REST_API_URL/TOKEN（旧 KV）。
 * 本地开发没有这些变量时回退到工作区 data/db.json 文件存储。
 */
class UpstashStorage implements KVStorage {
  private readonly client: Redis;

  constructor(url: string, token: string) {
    this.client = new Redis({ url, token });
  }

  async get(key: string): Promise<string | null> {
    return this.client.get<string>(key);
  }

  async set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<boolean> {
    let res: string | null;
    if (opts?.nx) {
      res = opts.ex !== undefined
        ? await this.client.set(key, value, { nx: true, ex: opts.ex })
        : await this.client.set(key, value, { nx: true });
    } else if (opts?.ex !== undefined) {
      res = await this.client.set(key, value, { ex: opts.ex });
    } else {
      res = await this.client.set(key, value);
    }
    return res === "OK";
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}

export function makeKV(): { kv: KVStorage; backend: "upstash-redis" | "file"; source: string } {
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.STORAGE_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.STORAGE_TOKEN;
  if (url && token) {
    const source = process.env.UPSTASH_REDIS_REST_URL
      ? "UPSTASH_REDIS_REST"
      : process.env.KV_REST_API_URL
        ? "KV_REST_API"
        : "STORAGE";
    return { kv: new UpstashStorage(url, token), backend: "upstash-redis", source };
  }
  const file = path.join(process.cwd(), "data", "db.json");
  return { kv: new FileKV(file), backend: "file", source: "file" };
}
