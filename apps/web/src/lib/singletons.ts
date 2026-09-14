import { Notifier, SteamClient, Store } from "@steam-monitor/core";
import { makeKV } from "./kv";

export const kvBackend = makeKV();
export const store = new Store(kvBackend.kv);

export const steam = new SteamClient({
  baseUrl: process.env.STEAM_BASE_URL,
  currency: Number(process.env.STEAM_CURRENCY ?? 23),
  proxyUrl: process.env.HTTP_PROXY || process.env.HTTPS_PROXY,
  logger: (m) => console.log(m),
});

export const notifier = new Notifier({ baseUrl: process.env.WECOM_BASE_URL });

let defaultsApplied: Promise<void> | null = null;

/** 首次启动时把环境变量里的 webhook key 作为默认值写入设置（页面可随时改） */
export function ensureDefaults(): Promise<void> {
  if (!defaultsApplied) {
    defaultsApplied = (async () => {
      const envKey = process.env.WECOM_WEBHOOK_KEY ?? "";
      if (!envKey) return;
      const settings = await store.getSettings();
      if (!settings.webhookKey) {
        settings.webhookKey = envKey;
        await store.saveSettings(settings);
      }
    })();
  }
  return defaultsApplied;
}
