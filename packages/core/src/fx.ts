import type { Store } from "./storage/store.ts";

/**
 * 汇率自动获取：从公开免费汇率接口（open.er-api.com）拉取 USD→CNY/HKD 汇率，
 * 缓存在存储中 24 小时；网络失败时回退到内置默认值。
 */

const FX_KEY = "fx:rates";
const FX_TTL_MS = 24 * 3600 * 1000;

/** 网络失败等场景下的兜底汇率 */
export const FX_FALLBACK: Record<string, number> = { CNY: 7.2, HKD: 7.8, USD: 1 };

interface FxCache {
  at: number;
  cny: number;
  hkd: number;
}

export async function fetchFxRates(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ cny: number; hkd: number } | null> {
  try {
    const res = await fetchImpl("https://open.er-api.com/v6/latest/USD", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { rates?: { CNY?: number; HKD?: number } };
    const cny = Number(j.rates?.CNY);
    const hkd = Number(j.rates?.HKD);
    if (!Number.isFinite(cny) || !Number.isFinite(hkd) || cny <= 0 || hkd <= 0) return null;
    return { cny, hkd };
  } catch {
    return null;
  }
}

/** 获取 1 美元 = X 目标币 的汇率（自动缓存 24h，失败回退默认值） */
export async function getUsdRate(
  store: Store,
  currency: string,
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<number> {
  if (currency === "USD") return 1;
  const cached = await store.getRawJson<FxCache>(FX_KEY);
  if (cached && Number.isFinite(cached.at) && Number.isFinite(cached.cny) && Date.now() - cached.at < FX_TTL_MS) {
    return currency === "CNY" ? cached.cny : cached.hkd ?? FX_FALLBACK.HKD;
  }
  const fresh = await fetchFxRates(fetchImpl);
  if (fresh) {
    await store.setRawJson(FX_KEY, { at: Date.now(), cny: fresh.cny, hkd: fresh.hkd });
    return currency === "CNY" ? fresh.cny : fresh.hkd;
  }
  return FX_FALLBACK[currency] ?? FX_FALLBACK.CNY;
}
