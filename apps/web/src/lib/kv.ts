import path from "node:path";
import { createClient } from "@vercel/kv";
import type { KVStorage } from "@steam-monitor/core";
import { FileKV } from "@steam-monitor/core";

/**
 * Vercel KV 适配器（部署到 Vercel 并关联 KV 后由环境变量驱动；
 * 本地开发没有 KV 变量时自动回退到工作区 data/db.json 文件存储）。
 */
class VercelKVStorage implements KVStorage {
  constructor(private readonly client: ReturnType<typeof createClient>) {}

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

export function makeKV(): { kv: KVStorage; backend: "vercel-kv" | "file" } {
  const { KV_REST_API_URL, KV_REST_API_TOKEN } = process.env;
  if (KV_REST_API_URL && KV_REST_API_TOKEN) {
    const client = createClient({ url: KV_REST_API_URL, token: KV_REST_API_TOKEN });
    return { kv: new VercelKVStorage(client), backend: "vercel-kv" };
  }
  const file = path.join(process.cwd(), "data", "db.json");
  return { kv: new FileKV(file), backend: "file" };
}
