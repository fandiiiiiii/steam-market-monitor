import type { KVStorage } from "./kv.ts";

/** 内存实现（单测用） */
export class MemoryKV implements KVStorage {
  private map = new Map<string, { v: string; expAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expAt != null && e.expAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return e.v;
  }

  async set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<boolean> {
    if (opts?.nx) {
      const cur = this.map.get(key);
      if (cur && (cur.expAt == null || cur.expAt > Date.now())) return false;
    }
    this.map.set(key, { v: value, expAt: opts?.ex ? Date.now() + opts.ex * 1000 : null });
    return true;
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
}
