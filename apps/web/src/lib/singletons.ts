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

/** 首次启动时把环境变量里的 webhook key / Steam Cookie 作为默认值写入设置（页面可随时改） */
export function ensureDefaults(): Promise<void> {
  if (!defaultsApplied) {
    defaultsApplied = (async () => {
      const settings = await store.getSettings();
      let changed = false;
      const envKey = process.env.WECOM_WEBHOOK_KEY ?? "";
      if (envKey && !settings.webhookKey) {
        settings.webhookKey = envKey;
        changed = true;
      }
      const envCookie = process.env.STEAM_COOKIE ?? "";
      if (envCookie && !settings.steamCookie) {
        settings.steamCookie = envCookie;
        changed = true;
      }
      if (changed) await store.saveSettings(settings);
    })();
  }
  return defaultsApplied;
}

/** 每次巡检/快照前注入最新设置里的 Steam Cookie */
export async function applySettingsToSteam(): Promise<void> {
  await ensureDefaults();
  const settings = await store.getSettings();
  steam.setCookies(settings.steamCookie);
}
