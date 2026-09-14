import { NextResponse, type NextRequest } from "next/server";
import { runRound } from "@steam-monitor/core";
import { monitorAuthorized } from "@/lib/auth";
import { ensureDefaults, notifier, steam, store } from "@/lib/singletons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * 巡检入口：
 * - 外部定时服务（cron-job.org 等）GET/POST 每分钟调用（带 ?key=CRON_SECRET）
 * - Vercel Cron（付费版）自动携带鉴权头
 * - 管理页面"立即巡检"按钮手动调用（携带 x-admin-token）
 */
export async function GET(req: NextRequest) {
  if (!monitorAuthorized(req)) return NextResponse.json({ error: "未授权" }, { status: 401 });
  await ensureDefaults();
  const summary = await runRound({ store, steam, notifier, onLog: (m) => console.log(m) });
  return NextResponse.json(summary);
}

export async function POST(req: NextRequest) {
  if (!monitorAuthorized(req)) return NextResponse.json({ error: "未授权" }, { status: 401 });
  await ensureDefaults();
  const summary = await runRound({ store, steam, notifier, onLog: (m) => console.log(m) });
  return NextResponse.json(summary);
}
