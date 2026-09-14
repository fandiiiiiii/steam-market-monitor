import { NextResponse } from "next/server";
import { ensureDefaults, kvBackend, store } from "@/lib/singletons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

/** 运行状态（页面顶部徽标 / 部署自检用） */
export async function GET() {
  await ensureDefaults();
  const [health, items, settings] = await Promise.all([store.getHealth(), store.getItems(), store.getSettings()]);
  const enabled = items.filter((i) => i.enabled).length;
  return NextResponse.json(
    {
      backend: kvBackend.backend,
      serverTime: Date.now(),
      pollEnabled: settings.pollEnabled,
      webhookKeySet: !!settings.webhookKey,
      itemsTotal: items.length,
      itemsEnabled: enabled,
      health,
    },
    { headers: NO_STORE },
  );
}
