/** 键值存储抽象：Vercel KV / 本地文件 / 内存均可实现 */
export interface KVStorage {
  get(key: string): Promise<string | null>;
  /** @returns 是否成功写入（nx 冲突时返回 false） */
  set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<boolean>;
  del(key: string): Promise<void>;
}
