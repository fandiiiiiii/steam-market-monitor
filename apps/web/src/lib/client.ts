"use client";

const TOKEN_KEY = "sm_admin_token";

export function getAdminToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setAdminToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

async function handle<T>(res: Response): Promise<T> {
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("未授权：请先在页面“全局设置 → 安全”中填写管理口令并点击保存，然后再操作");
    }
    throw new Error((j as { error?: string }).error ?? `请求失败（HTTP ${res.status}）`);
  }
  return j as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return fetch(path, { headers: { "x-admin-token": getAdminToken() } }).then((r) => handle<T>(r));
}

export function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  return fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-admin-token": getAdminToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => handle<T>(r));
}

export function fmtPrice(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtTime(ts: number): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

export const EVENT_TYPE_LABEL: Record<string, { text: string; cls: string }> = {
  new_listing: { text: "新上架", cls: "warn" },
  buy_order_change: { text: "求购变化", cls: "info" },
  price_drop: { text: "降价", cls: "warn" },
  sniped: { text: "最低价被秒", cls: "err" },
  monitor_error: { text: "监控异常", cls: "err" },
  monitor_recovered: { text: "监控恢复", cls: "ok" },
  system: { text: "系统", cls: "info" },
};
