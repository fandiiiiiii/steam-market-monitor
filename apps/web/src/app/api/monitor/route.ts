import { NextResponse, type NextRequest } from "next/server";
import { runRound, Store } from "@steam-monitor/core";
import { monitorAuthorized } from "@/lib/auth";
import { ensureDefaults, kvBackend, notifier, steam, store } from "@/lib/singletons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

async function run(req: NextRequest) {
  if (!monitorAuthorized(req)) return NextResponse.json({ error: "未授权" }, { status: 401 });
  await ensureDefaults();
  const summary = await runRound({ store, steam, notifier, onLog: (m) => console.log(m) });

  // ===== 诊断区 v3 =====
  const diag: Record<string, unknown> = {};
  diag.storeVersion = Store.VERSION;
  diag.backendSource = kvBackend.source;

  // 1) 巡检后立即读健康
  diag.healthAfter = await store.getHealth();

  // 2) store.saveHealth 写入后：同时用 store 与裸 KV 读回
  try {
    const t1 = Date.now();
    const h = await store.getHealth();
    h.lastRunAt = t1;
    h.roundsRun = (h.roundsRun ?? 0) + 1;
    h.lastError = `diag-${t1}`;
    await store.saveHealth(h);
    const viaStore = await store.getHealth();
    const viaRaw = await kvBackend.kv.get("health");
    diag.storeReadBack = viaStore;
    diag.rawReadBackAfterStoreWrite = viaRaw;
    diag.storeRoundtrip = viaStore.lastRunAt === t1;
  } catch (e) {
    diag.storeHealthError = e instanceof Error ? e.message : String(e);
  }

  // 3) 裸 KV：唯一键读写 + set 返回值
  try {
    const key = `dbg:${Date.now()}`;
    const setRes = await kvBackend.kv.set(key, "v1");
    const got = await kvBackend.kv.get(key);
    diag.rawSetReturn = setRes;
    diag.rawRoundtrip = got === "v1";
  } catch (e) {
    diag.rawError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({ ...summary, backend: kvBackend.backend, ...diag });
}

/**
 * 巡检入口：
 * - 外部定时服务（cron-job.org 等）GET/POST 每分钟调用（带 ?key=CRON_SECRET）
 * - Vercel Cron（付费版）自动携带鉴权头
 * - 管理页面"立即巡检"按钮手动调用（携带 x-admin-token）
 */
export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
