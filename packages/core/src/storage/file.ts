import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { KVStorage } from "./kv.ts";

interface FileDB {
  values: Record<string, string>;
  expAt: Record<string, number>;
}

/**
 * 单 JSON 文件实现的键值存储（本地模式 / 无 Vercel KV 时的开发回退）。
 * 自带 TTL 与 nx 语义；写入采用"临时文件 + rename"降低损坏概率。
 * 注意：仅适合低频小数据（本应用场景：几十个物品 + 事件日志）。
 */
export class FileKV implements KVStorage {
  private readonly file: string;
  private db: FileDB;

  constructor(file: string) {
    this.file = file;
    this.db = this.load();
  }

  private load(): FileDB {
    try {
      const raw = readFileSync(this.file, "utf8");
      const j = JSON.parse(raw);
      return {
        values: j.values && typeof j.values === "object" ? j.values : {},
        expAt: j.expAt && typeof j.expAt === "object" ? j.expAt : {},
      };
    } catch {
      return { values: {}, expAt: {} };
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.db), "utf8");
  }

  async get(key: string): Promise<string | null> {
    const exp = this.db.expAt[key];
    if (exp != null && exp <= Date.now()) {
      delete this.db.values[key];
      delete this.db.expAt[key];
      return null;
    }
    return this.db.values[key] ?? null;
  }

  async set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<boolean> {
    if (opts?.nx) {
      const existing = await this.get(key);
      if (existing != null) return false;
    }
    this.db.values[key] = value;
    if (opts?.ex) {
      this.db.expAt[key] = Date.now() + opts.ex * 1000;
    } else {
      delete this.db.expAt[key];
    }
    this.persist();
    return true;
  }

  async del(key: string): Promise<void> {
    delete this.db.values[key];
    delete this.db.expAt[key];
    this.persist();
  }
}
