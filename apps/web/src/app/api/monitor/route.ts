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
  // 自检：巡检后立刻读回健康数据与探针，验证同一进程内读写一致性
  const healthAfter = await store.getHealth();
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
  return NextResponse.json({ ...summary, backend: kvBackend.backend, healthAfter, probeOk, probeValue });
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
