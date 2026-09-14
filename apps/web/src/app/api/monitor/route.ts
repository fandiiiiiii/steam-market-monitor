import { NextResponse, type NextRequest } from "next/server";
import { runRound } from "@steam-monitor/core";
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

  // ===== 诊断区 =====
  const diag: Record<string, unknown> = {};

  // 1) 巡检后立即读健康（runner 内部 saveHealth 之后）
  diag.healthAfter = await store.getHealth();

  // 2) 用 Store 的同一套方法手动写健康再读回
  try {
    const t1 = Date.now();
    const h = await store.getHealth();
    h.lastRunAt = t1;
    h.roundsRun = (h.roundsRun ?? 0) + 1;
    await store.saveHealth(h);
    const h2 = await store.getHealth();
    diag.storeHealthRoundtrip = h2.lastRunAt === t1;
    diag.storeHealthValue = h2;
  } catch (e) {
    diag.storeHealthError = e instanceof Error ? e.message : String(e);
  }

  // 3) 裸 KV：写唯一键读回 + set 的返回值
  try {
    const key = `dbg:${Date.now()}`;
    const setRes = await kvBackend.kv.set(key, "v1");
    const got = await kvBackend.kv.get(key);
    diag.rawSetReturn = setRes;
    diag.rawGet = got;
    diag.rawRoundtrip = got === "v1";
  } catch (e) {
    diag.rawError = e instanceof Error ? e.message : String(e);
  }

  // 4) 裸 KV 直接读写 "health" 键
  try {
    const t3 = Date.now();
    const setRes2 = await kvBackend.kv.set("health", JSON.stringify({ lastRunAt: t3 }));
    const got2 = await kvBackend.kv.get("health");
    diag.rawHealthSetReturn = setRes2;
    diag.rawHealthGet = got2;
  } catch (e) {
    diag.rawHealthError = e instanceof Error ? e.message : String(e);
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
