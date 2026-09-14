import { NextResponse } from "next/server";
import { Store } from "@steam-monitor/core";
import { ensureDefaults, kvBackend, store } from "@/lib/singletons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

/** 运行状态（页面顶部徽标 / 部署自检用），附带存储读写自检探针 */
export async function GET() {
  await ensureDefaults();
  const [health, items, settings] = await Promise.all([store.getHealth(), store.getItems(), store.getSettings()]);
  const enabled = items.filter((i) => i.enabled).length;

  // 存储自检：写入探针再读回，验证写路径
  let probeOk = false;
  let probeValue: string | null = null;
  try {
    const probe = String(Date.now());
    await kvBackend.kv.set("probe", probe);
    probeValue = await kvBackend.kv.get("probe");
    probeOk = probeValue === probe;
  } catch (e) {
    probeValue = `写/读探针失败: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json(
    {
      backend: kvBackend.backend,
      backendSource: kvBackend.source,
      storeVersion: Store.VERSION,
      serverTime: Date.now(),
      pollEnabled: settings.pollEnabled,
      webhookKeySet: !!settings.webhookKey,
      itemsTotal: items.length,
      itemsEnabled: enabled,
      health,
      probeOk,
      probeValue,
    },
    { headers: NO_STORE },
  );
}
